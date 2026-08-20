/**
 * Minimal ambient types for `react-test-renderer`, which ships no declarations.
 *
 * Deliberately not `@types/react-test-renderer`: that package is pinned to React
 * 18 and conflicts with the React 19 types this project uses. Only the surface
 * the tests actually touch is declared, so the tests stay type-checked rather
 * than silently becoming `any`.
 */
declare module 'react-test-renderer' {
  import { ReactElement } from 'react';

  export interface TestInstance {
    findAllByType(type: unknown): TestInstance[];
    // Additive: needed by tests that walk the tree with an arbitrary predicate
    // (e.g. matching on accessibilityRole/accessibilityLabel) rather than by
    // element type.
    findAll(predicate: (node: TestInstance) => boolean): TestInstance[];
    // Additive: `any` mirrors @types/react-test-renderer's own typing of props
    // (host + composite components have arbitrary prop shapes).
    props: any;
  }

  // Additive: alias for the real react-test-renderer export name. `TestInstance`
  // above predates this task and stays as-is so existing imports keep working.
  export type ReactTestInstance = TestInstance;

  export interface ReactTestRenderer {
    update(element: ReactElement): void;
    unmount(): void;
    toJSON(): unknown;
    root: TestInstance;
  }

  export function create(element: ReactElement): ReactTestRenderer;

  export function act(callback: () => Promise<void>): Promise<void>;
  export function act(callback: () => void): void;

  // Additive: a non-instantiated namespace (types only, no runtime members) of
  // the same name as the default-exported const below merges with it. That lets
  // `import renderer from 'react-test-renderer'` use `renderer.ReactTestRenderer`
  // as a qualified type, the same pattern @types/moment uses for `moment.Moment`.
  namespace TestRenderer {
    export { ReactTestRenderer };
  }

  const TestRenderer: {
    create: typeof create;
    act: typeof act;
  };
  export default TestRenderer;
}
