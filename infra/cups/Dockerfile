# Servidor de impresión mínimo para la impresora de casa.
#
# La HP DeskJet 2600 no entiende PDF: sólo raster (PWG/URF), JPEG y PCL. CUPS
# con cups-filters hace esa conversión y habla IPP Everywhere con ella, así que
# no hace falta el driver de HP (hplip) ni ningún PPD propietario.
#
# No hay LibreOffice a propósito: pesa cientos de MB y no cabe en la Raspberry.
# Los documentos de Office se exportan a PDF antes de subirlos.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      cups cups-client cups-filters cups-ipp-utils \
      ghostscript poppler-utils fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && echo "ErrorLog stderr" >> /etc/cups/cups-files.conf

COPY cupsd.conf /etc/cups/cupsd.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 631
ENTRYPOINT ["entrypoint.sh"]
