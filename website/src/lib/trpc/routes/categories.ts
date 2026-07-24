import { t } from '$lib/trpc/t';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { CardsDB } from '@girae/database/cards';
import { z } from 'zod';

export const categoriesRouter = t.router({
	list: adminProcedure.query(() => CardsDB.getCategories()),

	createCategory: adminProcedure
		.input(z.object({ name: z.string(), emoji: z.string() }))
		.mutation(({ input }) => CardsDB.createCategory(input.name, input.emoji)),

	updateCategory: adminProcedure
		.input(
			z.object({
				id: z.number(),
				name: z.string().optional(),
				emoji: z.string().optional(),
				subcategoriesOnDraw: z.number().optional(),
				isHidden: z.boolean().optional(),
				drawImageUrl: z.string().optional()
			})
		)
		.mutation(({ input: { id, ...data } }) => CardsDB.updateCategory(id, data)),

	// scoped to one category for the card form's dropdown - already small, no pagination needed
	subcategories: adminProcedure
		.input(z.object({ categoryId: z.number() }))
		.query(({ input }) => CardsDB.getSubcategoriesWithCardCounts(input.categoryId)),

	// paginated, unscoped - backs the /admin/subcategories grid
	subcategoriesPaged: adminProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(20),
				offset: z.number().min(0).default(0),
				query: z.string().optional(),
				categoryId: z.number().optional(),
				sortField: z.enum(['name', 'rarityModifier']).optional(),
				sortDir: z.enum(['asc', 'desc']).optional()
			})
		)
		.query(({ input }) => CardsDB.listSubcategoriesForAdmin(input)),

	// powers SubcategoryPicker's search-as-you-type
	searchSubcategories: adminProcedure
		.input(z.object({ query: z.string(), limit: z.number().min(1).max(50).default(20) }))
		.query(({ input }) => CardsDB.searchSubcategoriesByName(input.query, input.limit)),

	// full row, fetched on demand when the edit form opens
	subcategory: adminProcedure
		.input(z.object({ id: z.number() }))
		.query(({ input }) => CardsDB.getSubcategory(input.id)),

	createSubcategory: adminProcedure
		.input(z.object({ name: z.string(), categoryId: z.number() }))
		.mutation(({ input }) => CardsDB.createSubcategory(input.name, input.categoryId)),

	updateSubcategory: adminProcedure
		.input(
			z.object({
				id: z.number(),
				name: z.string().optional(),
				tags: z.array(z.string()).optional(),
				isSecondary: z.boolean().optional(),
				imageUrl: z.string().optional(),
				emoji: z.string().optional(),
				rarityModifier: z.number().optional()
			})
		)
		.mutation(({ input: { id, ...data } }) => CardsDB.updateSubcategory(id, data)),

	deleteSubcategory: adminProcedure
		.input(z.object({ id: z.number() }))
		.mutation(({ input }) => CardsDB.deleteSubcategory(input.id))
});
