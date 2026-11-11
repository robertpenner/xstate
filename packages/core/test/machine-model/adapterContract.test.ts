import { compareCompoundTrace } from './compoundAdapter';
import { compareTrace, type Context } from './machineAdapter';

const inspections: ReadonlyArray<
  readonly [string, (value: object, key: string) => unknown]
> = [
  ['membership', (value, key) => key in value],
  ['descriptor', (value, key) => Object.getOwnPropertyDescriptor(value, key)],
  ['enumeration', (value) => Reflect.ownKeys(value)],
  ['prototype', (value) => Object.getPrototypeOf(value)]
];

describe.each([
  ['flat', compareTrace],
  ['compound', compareCompoundTrace]
] as const)('%s adapter contract', (_, compare) => {
  it('refuses a raised event even when the callback catches the refusal', () => {
    expect(() =>
      compare(
        {
          initial: 'a',
          context: {},
          states: {
            a: {
              on: {
                go: (_, enqueue) => {
                  try {
                    const raise = Reflect.get(enqueue, 'raise');
                    if (typeof raise === 'function') raise({ type: 'ignored' });
                  } catch (error) {
                    if (
                      !(error instanceof Error) ||
                      !error.message.startsWith('Unsupported')
                    )
                      throw error;
                  }
                  return {};
                }
              }
            }
          }
        },
        [{ type: 'go' }]
      )
    ).toThrow(/Unsupported enqueue operation/);
  });

  describe.each(['enqueue', 'arguments'])('%s reflection', (target) => {
    it.each(inspections)(
      'refuses %s even if the callback catches the error',
      (_, inspect) => {
        expect(() =>
          compare(
            {
              initial: 'a',
              context: {},
              states: {
                a: {
                  on: {
                    go: (args, enqueue) => {
                      try {
                        inspect(
                          target === 'enqueue' ? enqueue : args,
                          target === 'enqueue' ? 'raise' : 'self'
                        );
                      } catch (error) {
                        if (
                          !(error instanceof Error) ||
                          !error.message.startsWith('Unsupported')
                        )
                          throw error;
                      }
                      return {};
                    }
                  }
                }
              }
            },
            [{ type: 'go' }]
          )
        ).toThrow(/Unsupported/);
      }
    );
  });

  it.each(['ordinary', 'null'])(
    'preserves a null context until an empty %s-prototype patch',
    (prototype) => {
      const record = vi.fn();
      const context: Context = Object.create(null);
      const emptyPatch: Context =
        prototype === 'null' ? Object.create(null) : {};
      context.$prototype = 'user value';
      const trace = compare(
        {
          initial: 'a',
          context,
          states: {
            a: {
              on: {
                inspect: ({ context }, enqueue) => {
                  enqueue(
                    record,
                    Object.getPrototypeOf(context) === null,
                    context.toString === undefined,
                    context.$prototype
                  );
                },
                empty: { context: emptyPatch },
                patch: { context: { count: 1 } }
              }
            }
          }
        },
        [
          { type: 'inspect' },
          { type: 'empty' },
          { type: 'inspect' },
          { type: 'patch' },
          { type: 'inspect' }
        ]
      );
      expect(
        [trace[1], trace[3], trace[5]].map((step) => step.effects[0].args)
      ).toEqual([
        [true, true, 'user value'],
        [false, false, 'user value'],
        [false, false, 'user value']
      ]);
      expect(record).not.toHaveBeenCalled();
    }
  );

  it('preserves pre-exit prototype observations when selection returns a patch', () => {
    const record = vi.fn();
    const context: Context = Object.create(null);
    const trace = compare(
      {
        initial: 'a',
        context,
        states: {
          a: {
            exit: ({ context }, enqueue) => {
              enqueue(record, 'exit', Object.getPrototypeOf(context) === null);
            },
            on: {
              go: ({ context }, enqueue) => {
                enqueue(
                  record,
                  'selection',
                  Object.getPrototypeOf(context) === null
                );
                return { target: 'b', context: {} };
              }
            }
          },
          b: {
            entry: ({ context }, enqueue) => {
              enqueue(record, 'entry', Object.getPrototypeOf(context) === null);
            }
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].effects.map((effect) => effect.args)).toEqual([
      ['exit', true],
      ['selection', true],
      ['entry', false]
    ]);
  });
});
