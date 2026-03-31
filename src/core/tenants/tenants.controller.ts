import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { ForbiddenException } from '@nestjs/common';

@Controller('tenants')
@UseGuards(ClerkAuthGuard, RolesGuard)
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

  @Get()
  @Roles('superadmin')
  findAll() {
    return this.service.findAll();
  }

  @Get('paginated')
  @Roles('superadmin')
  findAllPaginated(@Query() query: ListTenantsDto) {
    return this.service.findAllPaginated(query);
  }

  @Get(':orgId')
  findOne(@Param('orgId') orgId: string, @CurrentAuth() auth: AuthPayload) {
    if (auth.role !== 'superadmin' && auth.tenantId !== orgId) {
      throw new ForbiddenException('Solo podés ver tu propio tenant');
    }
    return this.service.findOne(orgId);
  }

  @Post()
  @Roles('superadmin')
  create(@Body() dto: CreateTenantDto, @CurrentAuth() auth: AuthPayload) {
    return this.service.create(dto, auth.userId);
  }

  @Patch(':orgId')
  @Roles('superadmin')
  update(@Param('orgId') orgId: string, @Body() dto: UpdateTenantDto) {
    return this.service.update(orgId, dto);
  }

  @Put(':orgId/modules')
  @Roles('superadmin')
  setModules(@Param('orgId') orgId: string, @Body('modules') modules: string[]) {
    return this.service.setModules(orgId, modules);
  }

  @Delete(':orgId')
  @Roles('superadmin')
  remove(@Param('orgId') orgId: string) {
    return this.service.remove(orgId);
  }
}
