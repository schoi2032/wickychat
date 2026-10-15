import { ApiError } from "./api";

const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function readImage(req: Request, maxBytes: number) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "bad_form", "Send the file as multipart form data");
  }
  const file = form.get("file");
  if (!(file instanceof File))
    throw new ApiError(400, "no_file", "Put the image in a field called file");
  const ext = TYPES[file.type];
  if (!ext)
    throw new ApiError(
      415,
      "bad_type",
      "Only png, jpg, webp and gif images are allowed",
    );
  if (file.size > maxBytes)
    throw new ApiError(
      413,
      "too_big",
      `Image has to be under ${Math.round(maxBytes / 1024 / 1024)}MB`,
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const valid =
    file.type === "image/png"
      ? bytes.length >= 8 &&
        Buffer.from(bytes.subarray(0, 8)).toString("hex") === "89504e470d0a1a0a"
      : file.type === "image/jpeg"
        ? bytes.length >= 3 &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255
        : file.type === "image/gif"
          ? ["GIF87a", "GIF89a"].includes(
              Buffer.from(bytes.subarray(0, 6)).toString(),
            )
          : Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
            Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP";
  if (!valid)
    throw new ApiError(
      415,
      "bad_image",
      "The file contents do not match the image type.",
    );
  return { bytes, type: file.type, ext, form };
}
