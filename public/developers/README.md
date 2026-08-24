# Developer photos

Portraits for the "Meet the Developers" section on the landing page.

The section renders a monogram avatar when a developer has no photo yet, so
this folder can stay empty. To use a real portrait:

1. Drop the image here, e.g. `public/developers/bakul.jpg`.
2. Point that person's `image` field at it in `lib/data/developers.ts`:

   ```ts
   image: "/developers/bakul.jpg",
   ```

Square images work best — the card renders the avatar at 112x112 CSS pixels
inside a circle with `object-fit: cover`, so a ~400x400 source is plenty.

Nothing else needs changing: the card swaps from the monogram to the photo
automatically, and the alt text is derived from the developer's name.
