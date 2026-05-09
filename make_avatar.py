from PIL import Image, ImageDraw

SIZE = 512
BG = (45, 90, 55)
TREE = (240, 245, 230)
TRUNK = (90, 60, 35)

img = Image.new("RGB", (SIZE, SIZE), BG)
d = ImageDraw.Draw(img)

cx = SIZE // 2

trunk_w = 36
trunk_h = 90
trunk_top = 380
d.rectangle(
    [cx - trunk_w // 2, trunk_top, cx + trunk_w // 2, trunk_top + trunk_h],
    fill=TRUNK,
)

tiers = [
    (160, 100),
    (200, 195),
    (240, 290),
]
for half_w, base_y in tiers:
    d.polygon(
        [(cx - half_w, base_y + 80), (cx + half_w, base_y + 80), (cx, base_y - 30)],
        fill=TREE,
    )

img.save("/Users/a.kondratev/my-project/bot-fp/avatar.png", "PNG")
print("avatar.png written")
