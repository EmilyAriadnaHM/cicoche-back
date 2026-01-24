/*
  Warnings:

  - You are about to drop the column `address` on the `space` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `space` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `space` table. All the data in the column will be lost.
  - You are about to drop the column `ownerId` on the `space` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `space` table. All the data in the column will be lost.
  - You are about to drop the column `priceUnit` on the `space` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `space` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `space` table. All the data in the column will be lost.
  - Added the required column `descripcion` to the `Space` table without a default value. This is not possible if the table is not empty.
  - Added the required column `direccion` to the `Space` table without a default value. This is not possible if the table is not empty.
  - Added the required column `idPropietario` to the `Space` table without a default value. This is not possible if the table is not empty.
  - Added the required column `precioDia` to the `Space` table without a default value. This is not possible if the table is not empty.
  - Added the required column `precioHora` to the `Space` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tipoEspacio` to the `Space` table without a default value. This is not possible if the table is not empty.
  - Added the required column `titulo` to the `Space` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `space` DROP FOREIGN KEY `Space_ownerId_fkey`;

-- DropIndex
DROP INDEX `Space_ownerId_fkey` ON `space`;

-- AlterTable
ALTER TABLE `space` DROP COLUMN `address`,
    DROP COLUMN `description`,
    DROP COLUMN `isActive`,
    DROP COLUMN `ownerId`,
    DROP COLUMN `price`,
    DROP COLUMN `priceUnit`,
    DROP COLUMN `title`,
    DROP COLUMN `type`,
    ADD COLUMN `activo` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `descripcion` VARCHAR(191) NOT NULL,
    ADD COLUMN `direccion` VARCHAR(191) NOT NULL,
    ADD COLUMN `idPropietario` INTEGER NOT NULL,
    ADD COLUMN `precioDia` DOUBLE NOT NULL,
    ADD COLUMN `precioHora` DOUBLE NOT NULL,
    ADD COLUMN `tipoEspacio` VARCHAR(191) NOT NULL,
    ADD COLUMN `titulo` VARCHAR(191) NOT NULL;

-- AddForeignKey
ALTER TABLE `Space` ADD CONSTRAINT `Space_idPropietario_fkey` FOREIGN KEY (`idPropietario`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
