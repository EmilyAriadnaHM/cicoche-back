-- AlterTable
ALTER TABLE `chatmessage` ADD COLUMN `readByOccupantAt` DATETIME(3) NULL,
    ADD COLUMN `readByProviderAt` DATETIME(3) NULL;
