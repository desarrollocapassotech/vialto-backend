import { PartialType } from '@nestjs/swagger';
import { CreateOrdenTrabajoDto } from './create-orden-trabajo.dto';

/**
 * Edición parcial. `items` y `vehiculoPlanIds`, si vienen, reemplazan la lista entera.
 * `numero` y `estado` no se editan por acá (anular tiene su propia ruta).
 */
export class UpdateOrdenTrabajoDto extends PartialType(CreateOrdenTrabajoDto) {}
