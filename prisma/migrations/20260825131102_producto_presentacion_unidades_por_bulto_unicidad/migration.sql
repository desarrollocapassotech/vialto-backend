-- DropIndex
DROP INDEX "producto_presentaciones_productoId_presentacionId_key";

-- CreateIndex
CREATE UNIQUE INDEX "producto_presentaciones_productoId_presentacionId_unidade_key" ON "producto_presentaciones"("productoId", "presentacionId", "unidadesPorBulto");
