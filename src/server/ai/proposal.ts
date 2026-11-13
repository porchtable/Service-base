import { z } from "zod";

/**
 * Structured output requested from the model. Deliberately contains NO price,
 * discount, tax or warranty fields: the model can only reference price-book
 * items by id. Unknown keys are stripped by Zod.
 */
export const aiProposalSchema = z.object({
  summary: z.string().describe("Plain-language scope of work for the customer. No prices, discounts, taxes, warranties or guarantees."),
  line_items: z
    .array(
      z.object({
        description: z.string().describe("Customer-facing description of the work or part."),
        quantity: z.number().describe("Quantity in the price book item's unit."),
        price_book_item_id: z.string().nullable().describe("id of the matching catalog item, or null if nothing in the catalog matches."),
        confidence: z.enum(["high", "medium", "low"]),
        reason: z.string().nullable().describe("Why the match is uncertain or why no catalog item fits."),
      }),
    )
    .describe("Proposed estimate lines."),
  warnings: z.array(z.string()).describe("Anything the reviewer should double-check."),
});

export type AiProposal = z.infer<typeof aiProposalSchema>;

export interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  unitPriceCents: number;
  taxClass: "taxable" | "non_taxable";
}

export interface EstimateAiInput {
  trade: string;
  job: {
    title: string;
    description: string | null;
    equipment: string | null;
    observations: string | null;
  };
  technicianNotes: string;
  /** Prices are intentionally NOT sent to the model. */
  catalog: Array<Pick<CatalogItem, "id" | "name" | "description" | "category" | "unit">>;
}

export interface EstimateAiProvider {
  readonly model: string;
  propose(input: EstimateAiInput, signal?: AbortSignal): Promise<AiProposal>;
}

export class AiGenerationError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "AiGenerationError";
  }
}
