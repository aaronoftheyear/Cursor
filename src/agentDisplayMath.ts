import { emeraldDisplaySize } from './assets';

export interface ClickBoxTiles {
  width: number;
  height: number;
}

/** Display size for an agent sprite (Renderer.spritePixelSize logic). */
/** Rendered on-screen height from measured visible pixels in a source frame. */
export function renderedCharacterHeightFromVisible(
  visiblePixelHeight: number,
  frameHeight: number,
  tile: number,
  displayScale = 1
): number {
  const baseSize = emeraldDisplaySize(frameHeight, frameHeight, tile);
  const pixelsPerSource = baseSize.height / frameHeight;
  return visiblePixelHeight * pixelsPerSource * displayScale;
}

export function spritePixelSizeFromFrames(
  frameWidth: number,
  frameHeight: number,
  tile: number,
  displayScale = 1
): { width: number; height: number } {
  const size = emeraldDisplaySize(frameWidth, frameHeight, tile);
  return {
    width: Math.round(size.width * displayScale),
    height: Math.round(size.height * displayScale),
  };
}

/** Click box in canvas space (Renderer agent click box logic). */
export function agentClickBoxBounds(
  agentX: number,
  agentY: number,
  spriteSize: { width: number; height: number },
  tile: number,
  clickBoxTiles?: ClickBoxTiles | null
): { x: number; y: number; width: number; height: number } {
  if (clickBoxTiles) {
    const clickWidth = clickBoxTiles.width * tile;
    const clickHeight = clickBoxTiles.height * tile;
    const offsetX = (spriteSize.width - clickWidth) / 2;
    const offsetY = spriteSize.height - clickHeight;
    return {
      x: agentX + offsetX,
      y: agentY + offsetY,
      width: clickWidth,
      height: clickHeight,
    };
  }
  return {
    x: agentX,
    y: agentY,
    width: spriteSize.width,
    height: spriteSize.height,
  };
}

/**
 * Foot ellipse shadow (Renderer.drawAgentShadow). Uses click-box foot width when set,
 * so large sprites (e.g. cursor-cloud) do not get a person-sized shadow.
 */
export function agentShadowEllipseRadii(
  spriteSize: { width: number; height: number },
  tile: number,
  clickBoxTiles?: ClickBoxTiles | null,
  shadowScale = 1
): { radiusX: number; radiusY: number } {
  const footWidth = clickBoxTiles ? clickBoxTiles.width * tile : spriteSize.width;
  return {
    radiusX: (footWidth / 3) * shadowScale,
    radiusY: (footWidth / 6) * shadowScale,
  };
}
