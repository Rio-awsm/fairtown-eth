import { z } from "zod"

/** The subset of the Tiled JSON map format (.tmj) the town reads. Extra fields pass through. */
export const TiledObject = z.looseObject({
  id: z.number(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  point: z.boolean().optional(),
})
export const TiledLayer = z.looseObject({
  name: z.string(),
  type: z.string(),
  encoding: z.string().optional(),
  compression: z.string().optional(),
  data: z.union([z.array(z.number()), z.string()]).optional(),
  objects: z.array(TiledObject).optional(),
})
export const TiledTileset = z.looseObject({
  firstgid: z.number(),
  name: z.string().optional(),
  image: z.string().optional(),
  source: z.string().optional(),
})
export const TiledMap = z.looseObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  layers: z.array(TiledLayer),
  tilesets: z.array(TiledTileset),
})
export type TiledMap = z.infer<typeof TiledMap>
export type TiledLayer = z.infer<typeof TiledLayer>
export type TiledObject = z.infer<typeof TiledObject>
