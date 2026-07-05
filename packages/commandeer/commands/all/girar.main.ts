import type { CommandContext } from '@girae/common/commands'
import { getCategories, getSubcategoriesForCategoryDraw } from '@girae/database/cards'

export const name = 'girar'
export const aliases = ['rodar', 'rechear', 'carimbar', 'draw', 'gi']
export const description = 'Tente a sorte e pegue uma carta!'

export async function execute(ctx: CommandContext) {
  await ctx.reply('Pong!')

  const categories = await getCategories()
  await ctx.reply({
    content: 'Escolha uma categoria...',
    options: categories.map((c) => restrictedToAuthor(c.id, `${c.emoji} ${c.name}`)),
    nextStep: 'selectSubcategory'
  })
}

export async function selectSubcategory(ctx: CommandContext, categoryId: number) {
  const subcategories = await getSubcategoriesForCategoryDraw(categoryId)

  await ctx.reply({
    content: 'Escolha uma subcategoria...',
    options: subcategories.map((s) => restrictedToAuthor(s.id, s.name)),
    nextStep: 'rollDice'
  })
}

export async function rollDice(ctx: CommandContext, subcategoryId: number) {
}
