/*
  Warnings:

  - The primary key for the `spaceallowedvehicletype` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE `spaceallowedvehicletype` DROP PRIMARY KEY,
    MODIFY `type` ENUM('COCHE', 'CAMIONETA', 'MOTO', 'URBAN', 'REDILA') NOT NULL,
    ADD PRIMARY KEY (`spaceId`, `type`);

-- AlterTable
ALTER TABLE `vehicle` MODIFY `type` ENUM('COCHE', 'CAMIONETA', 'MOTO', 'URBAN', 'REDILA') NOT NULL;
