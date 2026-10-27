# Oracle face assets

Extracted from "Painted Face - Impasto Relief Reconstruction.html" (all four layers share the painting's 744 x 787 grid; sculpt is half size, 372 x 394).

- color.jpg   the painted face
- height.png  paint thickness read from the brushwork (grayscale)
- mask.png    the torn-edge cut-out silhouette
- sculpt.png  the optional sculpted volume beneath
- face_ascii.txt / face_ascii_preview.png   a first-pass static ASCII render (96 columns). Heavy rim, readable features. For reference only.

Use for the game: render the Oracle as a floating ASCII sun/face by lighting the height and sculpt maps and slowly rotating it, with the mask as its outline.
