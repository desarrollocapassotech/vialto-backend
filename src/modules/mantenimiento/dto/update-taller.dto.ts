import { PartialType } from '@nestjs/swagger';
import { CreateTallerDto } from './create-taller.dto';

/** Edición parcial; mandar `null` (o vacío) en cuit/teléfono lo borra. */
export class UpdateTallerDto extends PartialType(CreateTallerDto) {}
