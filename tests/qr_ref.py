"""Dump reference QR matrices using the python qrcode library for comparison."""
import sys
import qrcode

text = sys.argv[1]
mask = int(sys.argv[2])

qr = qrcode.QRCode(
    error_correction=qrcode.constants.ERROR_CORRECT_M,
    mask_pattern=mask,
    border=0,
)
qr.add_data(qrcode.util.QRData(text.encode("utf-8"), mode=qrcode.util.MODE_8BIT_BYTE), optimize=0)
qr.make(fit=True)
print(qr.version)
for row in qr.modules:
    print("".join("1" if cell else "0" for cell in row))
