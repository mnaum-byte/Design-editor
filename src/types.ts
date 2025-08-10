// Centralized type definitions used across the app

export type ImageAsset = {
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  element?: HTMLImageElement | null;
  bitmap?: ImageBitmap | null;
  loaded?: boolean;
  sourceUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
};

export type VideoAsset = {
  type: 'video';
  x: number;
  y: number;
  width: number;
  height: number;
  element?: HTMLVideoElement | null;
  ready?: boolean;
  sourceUrl?: string;
};

export type TextAsset = {
  type: 'text';
  x: number;
  y: number;
  text: string;
  color?: string;
  font?: string;
  maxWidth?: number;
  textAlign?: 'left' | 'center' | 'right';
};

export type Asset = ImageAsset | VideoAsset | TextAsset;

export type BackgroundLayer =
  | { type: 'image'; element?: HTMLImageElement | null; bitmap?: ImageBitmap | null }
  | { type: 'video'; element?: HTMLVideoElement | null; ready?: boolean }
  | { type: 'text'; text: string; font?: string; color?: string }
  | null;

export interface SelectionBounds { x: number; y: number; width: number; height: number }
export type SelectedSnapshot = Asset[];

export interface InteractionState {
  hoveredAssetIndex: number;
  selectedAssetIndices: Set<number>;
  isMovingSelected: boolean;
  lastMoveClientX: number;
  lastMoveClientY: number;
  isMarqueeSelecting: boolean;
  marqueePending: boolean;
  marqueePendingAdditive: boolean;
  marqueePendingStartCX: number;
  marqueePendingStartCY: number;
  marqueeStartCX: number;
  marqueeStartCY: number;
  marqueeEndCX: number;
  marqueeEndCY: number;
  marqueeAdditive: boolean;
  hoveredHandle: string | null;
  isResizingSelected: boolean;
  activeHandle: string | null;
  resizeStartClientX: number;
  resizeStartClientY: number;
  initialSelectionBounds: SelectionBounds | null;
  initialSelectedSnapshot: SelectedSnapshot | null;
  historyPushedInGesture: boolean;
  hoveringBackground: boolean;
}

export type Snapshot = { assets: Asset[]; background: BackgroundLayer };


