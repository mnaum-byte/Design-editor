import { describe, it, expect } from 'vitest';
import { CanvasRenderer, computeGeometry } from '@/canvas/renderer';

describe('renderer geometry', () => {
  it('computes grid geometry deterministically', () => {
    const geom = computeGeometry(1600, 900, 12, 8);
    expect(geom.cols).toBe(12);
    expect(geom.rows).toBe(8);
    expect(geom.verticals.length).toBe(11);
    expect(geom.horizontals.length).toBe(7);
  });
});

describe('CanvasRenderer', () => {
  it('initializes with a canvas', () => {
    const canvas = document.createElement('canvas');
    const renderer = new CanvasRenderer(canvas);
    expect(renderer.getDimensions().width).toBeGreaterThanOrEqual(1);
  });
});


