-- AlterTable
ALTER TABLE `user` ADD COLUMN `statusReason` VARCHAR(191) NULL,
    ADD COLUMN `statusUpdatedAt` DATETIME(3) NULL,
    ADD COLUMN `statusUpdatedById` INTEGER NULL;
