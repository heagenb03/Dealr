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

  export interface ReactTestRenderer {
    update(element: ReactElement): void;
    unmount(): void;
    toJSON(): unknown;
  }

  export function create(element: ReactElement): ReactTestRenderer;

  export function act(callback: () => Promise<void>): Promise<void>;
  export function act(callback: () => void): void;

  const TestRenderer: {
    create: typeof create;
    act: typeof act;
  };
  export default TestRenderer;
}
