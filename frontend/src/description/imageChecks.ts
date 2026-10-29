// Instant client-side refusals for the editor's Image button (spec 002 FR4). The server
// re-checks everything; these only spare an upload that would be refused anyway.

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES_PER_DESCRIPTION = 10;

const IMAGE_REF = /\/api\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export type ImageRefusal = {
  code: "image_format" | "image_too_large" | "too_many_images";
  message: string;
};

/** Distinct `/api/images/<uuid>` references in a description's Markdown source. */
export function imageReferenceCount(source: string): number {
  const ids = new Set([...source.matchAll(IMAGE_REF)].map((m) => (m[1] ?? "").toLowerCase()));
  return ids.size;
}

export function imageRefusal(
  file: { type: string; size: number },
  source: string,
): ImageRefusal | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return {
      code: "image_format",
      message: "This file can't be added. Use a PNG, JPEG, GIF or WebP image.",
    };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { code: "image_too_large", message: "This image is too large. The limit is 2 MB." };
  }
  if (imageReferenceCount(source) >= MAX_IMAGES_PER_DESCRIPTION) {
    return {
      code: "too_many_images",
      message: `A description can have at most ${MAX_IMAGES_PER_DESCRIPTION} images.`,
    };
  }
  return null;
}
