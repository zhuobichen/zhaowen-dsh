/**
 * Pixel-whale frames, converted from DeepDragon.jpg (DeepSeek whale logo).
 * 60x48 sprite, palette: D outline, B body, L belly, W eye/mouth, . transparent.
 * Frame 0: calm (round eyes + short mouth line). Frame 1: laughing (closed-eye slits + open grin).
 */
export interface WhaleFrame {
    readonly name: string;
    readonly rows: readonly string[];
}
export declare const WHALE_FRAMES: readonly WhaleFrame[];
export interface OpeningStep {
    readonly frame: number;
    readonly ms: number;
}
export declare const OPENING_SEQUENCE: readonly OpeningStep[];
//# sourceMappingURL=whaleFrames.d.ts.map