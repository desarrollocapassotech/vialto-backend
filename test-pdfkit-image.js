const fs = require('fs');
const PDFDocument = require('pdfkit');

async function test() {
  const url = 'https://res.cloudinary.com/db1avrahd/image/upload/v1784329443/vialto/arca-config/org_3EtziNRVAGnLlOgwHSgom24hqZe/logo-1784329442687.png';
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream('test-output.pdf'));
  
  try {
    doc.image(buffer, 0, 0, { width: 100 });
    console.log("SUCCESS");
  } catch(e) {
    console.error("PDFKIT ERROR:", e);
  }
  doc.end();
}

test();
