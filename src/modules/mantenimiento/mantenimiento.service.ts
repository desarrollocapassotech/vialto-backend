import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

/** Planes, talleres, órdenes de trabajo y vencimientos — se implementa en MANT-02. */
@Injectable()
export class MantenimientoService {
  constructor(private readonly prisma: PrismaService) {}
}
