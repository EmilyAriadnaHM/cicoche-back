-- AlterTable
ALTER TABLE `reservation` ADD COLUMN `vehicleId` INTEGER NULL;

-- AlterTable
ALTER TABLE `space` ADD COLUMN `capacity` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `SpaceAllowedVehicleType` (
    `spaceId` INTEGER NOT NULL,
    `type` ENUM('COCHE', 'CAMIONETA', 'MOTO', 'URBAN') NOT NULL,

    INDEX `SpaceAllowedVehicleType_type_idx`(`type`),
    PRIMARY KEY (`spaceId`, `type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Reservation_vehicleId_idx` ON `Reservation`(`vehicleId`);

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SpaceAllowedVehicleType` ADD CONSTRAINT `SpaceAllowedVehicleType_spaceId_fkey` FOREIGN KEY (`spaceId`) REFERENCES `Space`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
