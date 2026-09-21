// Shows a photo as large as possible inside a fixed-aspect container
// without cropping: the sharp photo is fitted with `object-contain`, and a
// blurred, zoomed copy of the same photo fills whatever space is left over
// (the "blurred backdrop" pattern). Used for team hero banners and their
// upload previews so a portrait/landscape team photo never has heads or
// legs cut off by the wide banner shape.
//
// The parent container must be `relative overflow-hidden` and size the box.
export function BlurFillImage({
  src,
  alt,
  testId,
}: {
  src: string;
  alt: string;
  testId?: string;
}) {
  return (
    <>
      <img
        src={src}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-md"
      />
      <img
        src={src}
        alt={alt}
        data-testid={testId}
        className="absolute inset-0 h-full w-full object-contain"
      />
    </>
  );
}
