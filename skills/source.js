// Source Skill — Find product on CJ, import to Shopify
// AI agent that searches supplier catalogs, picks the best option, and creates a Shopify listing
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Product Sourcer — you find products on supplier catalogs and import them into the Shopify store.

Your job: Search suppliers for a specific product, evaluate options, pick the best one, and create a fully-formed Shopify product listing.

## Process
1. Check existing products to avoid duplicates
2. Search the supplier catalog for the requested product
3. Get detailed info on the best options
4. Pick the best option (price, shipping speed, quality signals)
5. Set a profitable retail price and create the product on Shopify

## Pricing Formula
- Supplier cost + $3-5 shipping buffer = total cost
- Retail price = total cost / 0.35 (targeting ~65% markup = ~40% margin)
- Round to psychological price point ($X9.99)
- Set compare_at_price ~20% higher for perceived deal

## Product Listing Rules
- Title: Clear, SEO-friendly, no all-caps
- Description: Benefits over features. 3-4 bullet points in HTML.
- Vendor: "CJ Dropshipping"
- Product type: Set to the product category
- Status: "draft" by default (operator reviews before publishing)
- SKU: Set to CJ variant ID (vid) for order mapping

Be thorough. A bad listing wastes ad dollars.`

const tools = [
  {
    name: 'check_existing_products',
    description: 'Check if similar products already exist in the store.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const products = await shopify.getProducts({ fields: 'id,title,vendor,product_type' })
        return {
          count: products.length,
          products: products.map(p => ({
            title: p.title,
            vendor: p.vendor,
            type: p.product_type
          }))
        }
      } catch (err) {
        return { error: err.message, count: 0, products: [] }
      }
    }
  },
  {
    name: 'search_supplier',
    description: 'Search CJ Dropshipping catalog for products by keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Product keyword (e.g. "LED desk lamp")' }
      },
      required: ['keyword']
    },
    async execute(input) {
      try {
        const cj = await import('../lib/cj.js')
        const products = await cj.searchProducts(input.keyword, { pageSize: 15 })
        return {
          source: 'CJ Dropshipping',
          count: products.length,
          products: products.map(p => ({
            id: p.id,
            title: p.title,
            supplierPrice: p.price,
            image: p.image,
            category: p.category,
            shippingDays: p.shippingDays,
            variantCount: (p.variants || []).length,
            variants: (p.variants || []).slice(0, 5).map(v => ({
              vid: v.vid,
              name: v.name,
              price: v.price
            }))
          }))
        }
      } catch (err) {
        return { error: err.message, source: 'CJ Dropshipping', products: [] }
      }
    }
  },
  {
    name: 'get_product_detail',
    description: 'Get detailed info about a specific CJ product (description, images, all variants).',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'CJ product ID (pid)' }
      },
      required: ['productId']
    },
    async execute(input) {
      try {
        const cj = await import('../lib/cj.js')
        const detail = await cj.getProductDetail(input.productId)
        if (!detail) return { error: 'Product not found' }
        return {
          id: detail.id,
          title: detail.title,
          description: detail.description,
          price: detail.price,
          image: detail.image,
          images: (detail.images || []).slice(0, 5),
          weight: detail.weight,
          variants: detail.variants
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'create_shopify_product',
    description: 'Create a new product on Shopify from supplier data. Product is created in draft status.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Product title (SEO-friendly)' },
        bodyHtml: { type: 'string', description: 'Product description in HTML' },
        vendor: { type: 'string', description: 'Vendor name' },
        productType: { type: 'string', description: 'Product category' },
        price: { type: 'string', description: 'Retail price' },
        compareAtPrice: { type: 'string', description: 'Compare-at price for sale appearance' },
        sku: { type: 'string', description: 'CJ variant ID (vid) for order mapping' },
        imageUrl: { type: 'string', description: 'Main product image URL from CJ' },
        status: { type: 'string', enum: ['draft', 'active'], description: 'Product status (default: draft)' }
      },
      required: ['title', 'price']
    },
    async execute(input) {
      try {
        const productData = {
          title: input.title,
          body_html: input.bodyHtml || '',
          vendor: input.vendor || 'CJ Dropshipping',
          product_type: input.productType || '',
          status: input.status || 'draft',
          variants: [{
            price: input.price,
            compare_at_price: input.compareAtPrice || null,
            sku: input.sku || '',
            inventory_management: null,
            requires_shipping: true
          }],
          images: input.imageUrl ? [{ src: input.imageUrl }] : []
        }

        const product = await shopify.createProduct(productData)

        logger.success(`Created: ${product.title}`)
        logger.kv('  ID', product.id)
        logger.kv('  Price', `$${input.price}`)
        logger.kv('  Status', input.status || 'draft')

        await db.logAction({
          shop: config.getShop(),
          type: 'SOURCE',
          message: `Created product: ${input.title} at $${input.price}`,
          metadata: { productId: product.id, supplier: input.vendor, sku: input.sku }
        })

        return { created: true, productId: product.id, title: product.title, handle: product.handle }
      } catch (err) {
        return { created: false, error: err.message }
      }
    }
  },
  {
    name: 'present_source_report',
    description: 'Present the final sourcing report to the operator.',
    inputSchema: {
      type: 'object',
      properties: {
        productsFound: { type: 'number', description: 'Total supplier results found' },
        productCreated: { type: 'boolean', description: 'Whether a Shopify product was created' },
        supplierPrice: { type: 'number', description: 'Supplier cost' },
        retailPrice: { type: 'number', description: 'Set retail price' },
        estimatedMargin: { type: 'string', description: 'Estimated margin %' },
        supplier: { type: 'string', description: 'Supplier name' },
        summary: { type: 'string', description: 'Summary of what was done' }
      },
      required: ['summary']
    },
    async execute(input) {
      logger.header('Sourcing Report')
      if (input.productsFound != null) logger.kv('Products Found', input.productsFound)
      if (input.productCreated) {
        logger.success('Product created on Shopify (draft)')
      } else if (input.productCreated === false) {
        logger.dim('No product created (dry run or no match)')
      }
      if (input.supplierPrice) logger.kv('Supplier Cost', logger.money(input.supplierPrice))
      if (input.retailPrice) logger.kv('Retail Price', logger.money(input.retailPrice))
      if (input.estimatedMargin) logger.kv('Est. Margin', input.estimatedMargin)
      if (input.supplier) logger.kv('Supplier', input.supplier)
      logger.blank()
      logger.info(input.summary)
      return { displayed: true }
    }
  }
]

async function run(opts = {}) {
  logger.header('Product Sourcer')

  if (!opts.query) {
    logger.error('Specify a product to source: dropship source "LED desk lamp"')
    return
  }

  logger.spin(`Sourcing: ${opts.query}...`)

  const task = opts.dryRun
    ? `Search for "${opts.query}" on supplier catalogs. Evaluate options and recommend the best one, but do NOT create the product on Shopify. Present a sourcing report.`
    : `Search for "${opts.query}" on supplier catalogs. Find the best option (price, shipping, quality), then create it as a Shopify product in draft status. Present a sourcing report.`

  const activeTools = opts.dryRun
    ? tools.filter(t => t.name !== 'create_shopify_product')
    : tools

  const result = await runAgent({
    system: SYSTEM,
    task,
    tools: activeTools,
    maxIterations: 10,
    onAction(name) {
      if (name === 'check_existing_products') logger.spin('Checking for duplicates...')
      if (name === 'search_supplier') logger.spin('Searching supplier catalog...')
      if (name === 'get_product_detail') logger.spin('Getting product details...')
      if (name === 'create_shopify_product') logger.spin('Creating Shopify product...')
    }
  })

  logger.stopSpin(result.success ? 'Sourcing complete' : 'Sourcing failed', result.success)
  if (!result.success) logger.error(result.result)

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
