/**
 * TEMPORARY — deleted with frontend/utils/devProbes.ts in Task 11.
 *
 * Probe 3's live-mount census is the number gates G3 and G4 turn on, so the
 * counter itself gets a test rather than being trusted.
 */
import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

import {
  useScreenProbe,
  __resetScreenProbeForTests,
  __getLiveCountForTests,
} from '@/utils/devProbes';

function Screen({ gameId }: { gameId?: string }) {
  useScreenProbe('active', gameId);
  return null;
}

beforeEach(() => {
  __resetScreenProbeForTests();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  (console.log as jest.Mock).mockRestore?.();
});

describe('useScreenProbe census', () => {
  it('counts a single mount and returns to zero on unmount', async () => {
    let r: ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<Screen gameId="g1" />);
    });
    expect(__getLiveCountForTests('active')).toBe(1);

    await act(async () => {
      r!.unmount();
    });
    expect(__getLiveCountForTests('active')).toBe(0);
  });

  it('counts concurrently mounted instances, which is what H1 predicts', async () => {
    let a: ReactTestRenderer;
    let b: ReactTestRenderer;
    await act(async () => {
      a = TestRenderer.create(<Screen gameId="g1" />);
      b = TestRenderer.create(<Screen gameId="g2" />);
    });
    expect(__getLiveCountForTests('active')).toBe(2);

    await act(async () => {
      a!.unmount();
    });
    expect(__getLiveCountForTests('active')).toBe(1);
  });

  it('does not increment the census on a re-render of the same instance', async () => {
    // A wrong count after update() alone doesn't discriminate: an effect keyed
    // on `gameId` would fire cleanup (UNMOUNT, live 1->0) then re-run (MOUNT,
    // live 0->1) across the update, netting back to 1 despite being exactly
    // the bug the module's dep-array comment warns against. So assert on the
    // [probe3] MOUNT/UNMOUNT log sequence itself, not just the steady-state
    // count. The render-body [probe4] line is expected to fire again on
    // update and is deliberately not part of this filter.
    const logs: string[] = [];
    (console.log as jest.Mock).mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });

    let r: ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<Screen gameId="g1" />);
    });
    const censusLogsBeforeUpdate = logs.filter((l) => l.includes('[probe3]'));

    await act(async () => {
      r!.update(<Screen gameId="g1-renamed" />);
    });
    const censusLogsAfterUpdate = logs.filter((l) => l.includes('[probe3]'));

    expect(censusLogsAfterUpdate).toEqual(censusLogsBeforeUpdate);
    expect(__getLiveCountForTests('active')).toBe(1);
  });

  it('gives each instance a distinct id so a blurred instance is identifiable', async () => {
    const logs: string[] = [];
    (console.log as jest.Mock).mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
    await act(async () => {
      TestRenderer.create(<Screen gameId="g1" />);
      TestRenderer.create(<Screen gameId="g2" />);
    });
    expect(logs.some((l) => l.includes('active#1'))).toBe(true);
    expect(logs.some((l) => l.includes('active#2'))).toBe(true);
  });
});
