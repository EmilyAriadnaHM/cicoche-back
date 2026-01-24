-- AlterTable
ALTER TABLE `reservation` ADD COLUMN `billingMode` ENUM('HORA', 'DIA', 'AUTO') NOT NULL DEFAULT 'AUTO';
