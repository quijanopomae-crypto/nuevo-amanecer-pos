from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib import pdfencrypt
W,H=A4
def fact(c,page,rows,tot=None):
    c.setFont('Helvetica-Bold',16); c.drawString(40,H-50,'DISTRIBUIDORA LOS ANDES S.A.C.'); c.setFont('Helvetica',10); c.drawString(40,H-66,'RUC 20601234567  Av. Industrial 123 - Lima')
    c.setFont('Helvetica-Bold',13); c.drawString(380,H-50,'FACTURA F001-004800'); c.setFont('Helvetica',10); c.drawString(380,H-66,'Fecha: 21/10/2026   Pagina %d de 2'%page)
    y=H-110; c.setFont('Helvetica-Bold',10)
    for x,t in zip((40,80,120,180,430,500),('CANT','UM','COD','DESCRIPCION','P.UNIT','IMPORTE')): c.drawString(x,y,t)
    c.setFont('Helvetica',10); y-=20
    for r in rows:
        for x,t in zip((40,80,120,180,430,500),r): c.drawString(x,y,str(t))
        y-=18
    if tot: c.setFont('Helvetica-Bold',12); c.drawString(400,y-20,'TOTAL S/ '+tot)
    c.showPage()
c=canvas.Canvas('pdf/ocr007_factura_2p.pdf',pagesize=A4)
fact(c,1,[(2,'CJ','LG395','LECHE GLORIA 24 LATAS X 395GR','91.00','182.00'),(3,'CJ','WN126','WAFER NIK 12 PCK X 6 UND','38.40','115.20')])
fact(c,2,[(12,'UND','GP3024','GLOBOPOP 30 BLS X 24 UN','4.50','54.00'),(1,'CJ','AP12','ACEITE PRIMOR 12 X 1L','118.50','118.50')],'469.70')
c.save()
enc=pdfencrypt.StandardEncryption('clave123',canPrint=0)
c=canvas.Canvas('pdf/ocr008_protegido.pdf',pagesize=A4,encrypt=enc); fact(c,1,[(2,'CJ','LG395','LECHE GLORIA 24 LATAS X 395GR','91.00','182.00')],'182.00'); c.save()
items=[('LECHE GLORIA EVAPORADA 24 LATAS X 395GR','91.00'),('WAFER NIK 12 PCK X 6 UND','38.40'),('GLOBOPOP 30 BLS X 24 UN','4.50'),('ARROZ COSTEÑO SACO 50KG','182.00'),('AZUCAR RUBIA SACO 50KG','165.00'),('ACEITE PRIMOR 12 X 1L','118.50'),('FIDEO DON VITTORIO 20 X 500G','62.00'),('ATUN FLORIDA 48 X 170G','249.60'),('INCA KOLA 12 X 500ML','24.00'),('COCA COLA 12 X 500ML','24.00')]
c=canvas.Canvas('pdf/ocr022_lista_40p.pdf',pagesize=A4)
for p in range(1,41):
    c.setFont('Helvetica-Bold',15); c.drawString(40,H-50,'ALMACENES VICTORIA - LISTA DE PRECIOS MAYORISTA'); c.setFont('Helvetica',10); c.drawString(40,H-66,'Vigente 20/10/2026  -  Pagina %d de 40'%p)
    y=H-100; c.setFont('Helvetica-Bold',10); c.drawString(40,y,'CODIGO'); c.drawString(110,y,'PRODUCTO'); c.drawString(470,y,'PRECIO S/'); y-=18; c.setFont('Helvetica',10)
    for i in range(38):
        n,pr=items[(p*38+i)%len(items)]; v=float(pr)*(1+((p+i)%7)/100)
        c.drawString(40,y,'AV%03d%02d'%(p,i)); c.drawString(110,y,n+(' LOTE-%d'%p if i%5==0 else '')); c.drawString(470,y,'%.2f'%v); y-=19
    c.showPage()
c.save()
