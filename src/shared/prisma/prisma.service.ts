import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.connectWithRetry();
  }

  private async connectWithRetry(retries = 5, delayMs = 2000): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Database connected');
        return;
      } catch (error) {
        this.logger.warn(
          `Database connection attempt ${attempt}/${retries} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    this.logger.error('Could not connect to the database after all retries');
  }
}
