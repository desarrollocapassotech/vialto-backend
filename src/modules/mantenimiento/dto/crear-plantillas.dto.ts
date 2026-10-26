import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

/** Body opcional de `POST planes/plantillas`: sin `nombres` se cargan todas las que falten. */
export class CrearPlantillasDto {
  @ApiPropertyOptional({ type: [String], example: ['VTV/RTO', 'Póliza de seguro'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  nombres?: string[];
}
