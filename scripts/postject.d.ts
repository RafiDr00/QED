/** postject ships no types; this is the one call scripts/build-binary.ts makes. */
declare module "postject" {
  export function inject(
    filename: string,
    resourceName: string,
    resourceData: Uint8Array,
    options?: {
      readonly sentinelFuse?: string;
      readonly machoSegmentName?: string;
      readonly overwrite?: boolean;
    },
  ): Promise<void>;
}
