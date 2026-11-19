"""Mean linear radiance of image regions from a notonemap screenshot (rdebug=notonemap&exposure=E).
usage: python3 measure.py shot.png E x0,y0,x1,y1[:name] ...   (pixel boxes)"""
import sys, numpy as np
from PIL import Image
img = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float64) / 255.0
E = float(sys.argv[2])
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
H, W = lin.shape[:2]
yy, xx = np.mgrid[0:H, 0:W]
qx, qy = (xx / W - 0.5) * 2, (yy / H - 0.5) * 2
vig = 1 - 0.22 * (0.5 * (qx * qx + qy * qy)) ** 1.4
lin = lin / vig[..., None] / E
out = {}
for spec in sys.argv[3:]:
    box, _, name = spec.partition(':')
    x0, y0, x1, y1 = map(int, box.split(','))
    m = lin[y0:y1, x0:x1].reshape(-1, 3).mean(0)
    clip = (img[y0:y1, x0:x1] > 0.995).mean()
    out[name or box] = m
    print(f'{name or box:>10}: {m[0]:.4f} {m[1]:.4f} {m[2]:.4f}   lum {0.2126*m[0]+0.7152*m[1]+0.0722*m[2]:.4f}  clip {clip:.3f}')
