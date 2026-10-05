import { PartialType } from '@nestjs/swagger';
import { CreatePlanMantenimientoDto } from './create-plan-mantenimiento.dto';

/** Edición parcial; mandar `null` en un intervalo/aviso lo borra. */
export class UpdatePlanMantenimientoDto extends PartialType(CreatePlanMantenimientoDto) {}
