import { z } from "zod";
import { context, createMiddleware, tool } from "langchain";

const SKILLS: Skill[] = [
  {
    name: "sales_analytics",
    description:
      "Database schema and business logic for sales data analysis including customers, orders, and revenue.",
    keywords: ["sales", "analytics", "revenue", "customers"],
    content: context`
    # Sales Analytics Schema

    ## Tables

    ### customers
    - customer_id (PRIMARY KEY)
    - name
    - email
    - signup_date
    - status (active/inactive)
    - customer_tier (bronze/silver/gold/platinum)

    ### orders
    - order_id (PRIMARY KEY)
    - customer_id (FOREIGN KEY -> customers)
    - order_date
    - status (pending/completed/cancelled/refunded)
    - total_amount
    - sales_region (north/south/east/west)

    ### order_items
    - item_id (PRIMARY KEY)
    - order_id (FOREIGN KEY -> orders)
    - product_id
    - quantity
    - unit_price
    - discount_percent

    ## Business Logic

    **Active customers**:
    status = 'active' AND signup_date <= CURRENT_DATE - INTERVAL '90 days'

    **Revenue calculation**:
    Only count orders with status = 'completed'.
    Use total_amount from orders table, which already accounts for discounts.

    **Customer lifetime value (CLV)**:
    Sum of all completed order amounts for a customer.

    **High-value orders**:
    Orders with total_amount > 1000

    ## Example Query

    -- Get top 10 customers by revenue in the last quarter
    SELECT
        c.customer_id,
        c.name,
        c.customer_tier,
        SUM(o.total_amount) as total_revenue
    FROM customers c
    JOIN orders o ON c.customer_id = o.customer_id
    WHERE o.status = 'completed'
    AND o.order_date >= CURRENT_DATE - INTERVAL '3 months'
    GROUP BY c.customer_id, c.name, c.customer_tier
    ORDER BY total_revenue DESC
    LIMIT 10;`,
  },
  {
    name: "inventory_management",
    description:
      "Database schema and business logic for inventory tracking including products, warehouses, and stock levels.",
    keywords: ["inventory", "stock", "warehouse", "products"],
    content: context`
    # Inventory Management Schema

    ## Tables

    ### products
    - product_id (PRIMARY KEY)
    - product_name
    - sku
    - category
    - unit_cost
    - reorder_point (minimum stock level before reordering)
    - discontinued (boolean)

    ### warehouses
    - warehouse_id (PRIMARY KEY)
    - warehouse_name
    - location
    - capacity

    ### inventory
    - inventory_id (PRIMARY KEY)
    - product_id (FOREIGN KEY -> products)
    - warehouse_id (FOREIGN KEY -> warehouses)
    - quantity_on_hand
    - last_updated

    ### stock_movements
    - movement_id (PRIMARY KEY)
    - product_id (FOREIGN KEY -> products)
    - warehouse_id (FOREIGN KEY -> warehouses)
    - movement_type (inbound/outbound/transfer/adjustment)
    - quantity (positive for inbound, negative for outbound)
    - movement_date
    - reference_number

    ## Business Logic

    **Available stock**:
    quantity_on_hand from inventory table where quantity_on_hand > 0

    **Products needing reorder**:
    Products where total quantity_on_hand across all warehouses is less
    than or equal to the product's reorder_point

    **Active products only**:
    Exclude products where discontinued = true unless specifically analyzing discontinued items

    **Stock valuation**:
    quantity_on_hand * unit_cost for each product

    ## Example Query

    -- Find products below reorder point across all warehouses
    SELECT
        p.product_id,
        p.product_name,
        p.reorder_point,
        SUM(i.quantity_on_hand) as total_stock,
        p.unit_cost,
        (p.reorder_point - SUM(i.quantity_on_hand)) as units_to_reorder
    FROM products p
    JOIN inventory i ON p.product_id = i.product_id
    WHERE p.discontinued = false
    GROUP BY p.product_id, p.product_name, p.reorder_point, p.unit_cost
    HAVING SUM(i.quantity_on_hand) <= p.reorder_point
    ORDER BY units_to_reorder DESC;`,
  },
];

// A skill that can be progressively disclosed to the agent
const SkillSchema = z.object({
  name: z.string(), // Unique identifier for the skill
  description: z.string(), // 1-2 sentence description to show in system prompt
  content: z.string(), // Full skill content with detailed instructions
  keywords: z.array(z.string()).optional(), // Alternative names/aliases for the skill
});

type Skill = z.infer<typeof SkillSchema>;

// Skills cache to track active skills
class SkillsCache {
  private activeSkills: Set<string> = new Set();

  findSkill(query: string): Skill | undefined {
    const normalizedQuery = query.toLowerCase().trim();

    // Direct name match
    for (const skill of SKILLS) {
      if (skill.name.toLowerCase() === normalizedQuery) {
        return skill;
      }
    }

    // Partial name or keyword match
    for (const skill of SKILLS) {
      if (skill.name.toLowerCase().includes(normalizedQuery) || normalizedQuery.includes(skill.name.toLowerCase())) {
        return skill;
      }
      if (skill.keywords?.some(k => k.toLowerCase() === normalizedQuery)) {
        return skill;
      }
    }

    return undefined;
  }

  activateSkill(name: string): { success: boolean; message: string; skill?: Skill } {
    const skill = this.findSkill(name);

    if (!skill) {
      const available = SKILLS.map((s) => s.name).sort().join(', ');
      return {
        success: false,
        message: `Skill "${name}" not found. Available skills: ${available}`
      };
    }

    this.activeSkills.add(skill.name);
    return {
      success: true,
      message: `✓ Activated skill: ${skill.name}`,
      skill
    };
  }

  deactivateSkill(name: string): { success: boolean; message: string } {
    const skill = this.findSkill(name);

    if (!skill) {
      return { success: false, message: `Skill "${name}" not found.` };
    }

    if (this.activeSkills.has(skill.name)) {
      this.activeSkills.delete(skill.name);
      return { success: true, message: `Deactivated skill: ${skill.name}` };
    }

    return { success: false, message: `Skill "${name}" was not active.` };
  }

  listSkills() {
    return SKILLS.map(s => ({
      name: s.name,
      description: s.description,
      active: this.activeSkills.has(s.name),
      keywords: s.keywords,
    }));
  }

  getActiveSkillNames(): string[] {
    return Array.from(this.activeSkills);
  }

  getActiveSkillContent(skillName: string): string | undefined {
    const skill = SKILLS.find(s => s.name === skillName);
    return skill?.content;
  }

  getAllSkillNames(): string[] {
    return SKILLS.map(s => s.name).sort();
  }
}

const cache = new SkillsCache();

const activateSkill = tool(
  async ({ name }) => {
    const result = cache.activateSkill(name);

    if (result.success && result.skill) {
      return `${result.message}\n\nThe skill instructions are now part of your system prompt.`;
    }

    return result.message;
  },
  {
    name: "activate_skill",
    description: `Activate a skill to load its instructions into context. Use when the user asks to 'activate' or 'use' a specific skill.`,
    schema: z.object({
      name: z.string().describe("The name or keyword of the skill to activate (e.g., 'sales_analytics', 'inventory', 'revenue')"),
    }),
  }
);

const deactivateSkill = tool(
  async ({ name }) => {
    const result = cache.deactivateSkill(name);
    return result.message;
  },
  {
    name: "deactivate_skill",
    description: "Deactivate an active skill to remove its instructions from context",
    schema: z.object({
      name: z.string().describe("The name of the skill to deactivate"),
    }),
  }
);

const listSkills = tool(
  async () => {
    return {
      skills: cache.listSkills()
    };
  },
  {
    name: "list_skills",
    description: "List all available skills with their descriptions and active status",
    schema: z.object({}),
  }
);

// Build skills prompt from the SKILLS list
const skillsPrompt = SKILLS.map(
  (skill) => `- **${skill.name}**: ${skill.description}`
).join("\n");


export const skillMiddleware = createMiddleware({
  name: "skillMiddleware",
  tools: [activateSkill, deactivateSkill, listSkills],
  wrapModelCall: async (request, handler) => {
    const activeSkillNames = cache.getActiveSkillNames();

    // No active skills - just show available skills briefly
    if (activeSkillNames.length === 0) {
      const skillsAddendum =
        `\n\n## Skills System\n\n` +
        `You have access to optional skill modules. Available skills: ${cache.getAllSkillNames().join(', ')}.\n` +
        `When a user asks to "activate [skill]" or "use [skill]", use the activate_skill tool.`;

      const newSystemPrompt = request.systemPrompt + skillsAddendum;
      return handler({
        ...request,
        systemPrompt: newSystemPrompt,
      });
    }

    // Build prompt with active skill content
    let skillsPrompt = `\n\n---\n\n## Active Skills\n\nThe following skills are currently active:\n\n`;

    for (const skillName of activeSkillNames) {
      const content = cache.getActiveSkillContent(skillName);
      const skill = SKILLS.find(s => s.name === skillName);

      if (skill) {
        skillsPrompt += `### ${skill.name}\n\n${skill.description}\n\n`;
        if (content) {
          skillsPrompt += `${content}\n\n`;
        }
      }
    }

    const newSystemPrompt = request.systemPrompt + skillsPrompt;

    return handler({
      ...request,
      systemPrompt: newSystemPrompt,
    });
  },
});
