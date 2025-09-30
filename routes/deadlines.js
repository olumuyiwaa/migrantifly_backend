const express = require('express');
const { query, param, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { Application } = require('../models/Application');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Apply auth once for this router
router.use(auth);


// Simple role guard
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

const DEADLINE_TYPES = ['rfi', 'ppi', 'medical', 'document'];

function parseBool(val, def = undefined) {
  if (val === undefined) return def;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return def;
}

function buildDeadlineFilters({ status, type, from, to, completed }) {
  const and = [];

  // Completed flag takes precedence if provided
  if (typeof completed === 'boolean') {
    and.push({ 'deadlines.completed': completed });
  } else if (status) {
    const now = new Date();
    if (status === 'overdue') {
      and.push({ 'deadlines.completed': false });
      and.push({ 'deadlines.dueDate': { $lt: now } });
    } else if (status === 'upcoming') {
      and.push({ 'deadlines.completed': false });
      and.push({ 'deadlines.dueDate': { $gte: now } });
    } else if (status === 'completed') {
      and.push({ 'deadlines.completed': true });
    }
    // status === 'all' => no additional filter
  } else {
    // default: exclude completed unless explicitly requested
    and.push({ 'deadlines.completed': false });
  }

  if (type && DEADLINE_TYPES.includes(type)) {
    and.push({ 'deadlines.type': type });
  }

  const dateRange = {};
  if (from) dateRange.$gte = new Date(from);
  if (to) dateRange.$lte = new Date(to);
  if (Object.keys(dateRange).length) {
    and.push({ 'deadlines.dueDate': dateRange });
  }

  return and.length ? { $and: and } : {};
}

function toObjectId(id) {
  return new mongoose.Types.ObjectId(id);
}

async function runDeadlineAggregation({ baseMatch, deadlineFilters, page, limit, sortOrder, includeSummary }) {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  const basePipeline = [
    { $match: baseMatch },
    { $unwind: '$deadlines' },
    Object.keys(deadlineFilters).length ? { $match: deadlineFilters } : null,
    {
      $addFields: {
        overdue: {
          $and: [
            { $eq: ['$deadlines.completed', false] },
            { $lt: ['$deadlines.dueDate', now] }
          ]
        },
        daysRemaining: {
          $ceil: {
            $divide: [
              { $subtract: ['$deadlines.dueDate', now] },
              dayMs
            ]
          }
        },
        // Helper fields for summary buckets
        isDueToday: {
          $and: [
            { $eq: [ { $dateToString: { date: '$deadlines.dueDate', format: '%Y-%m-%d' } }, { $dateToString: { date: now, format: '%Y-%m-%d' } } ] }
          ]
        },
        isDueSoon: {
          $and: [
            { $eq: ['$deadlines.completed', false] },
            { $gte: ['$deadlines.dueDate', now] },
            { $lte: ['$deadlines.dueDate', new Date(now.getTime() + 7 * dayMs)] }
          ]
        }
      }
    },
    {
      $project: {
        applicationId: '$_id',
        clientId: 1,
        adviserId: 1,
        visaType: 1,
        stage: 1,
        deadline: '$deadlines',
        overdue: 1,
        daysRemaining: 1
      }
    },
    { $sort: { 'deadline.dueDate': sortOrder } },
  ].filter(Boolean);

  const pipeline = [
    ...basePipeline,
    {
      $facet: {
        data: [
          { $skip: (page - 1) * limit },
          { $limit: limit }
        ],
        totalCount: [
          { $count: 'count' }
        ],
        ...(includeSummary ? {
          summary: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                overdue: {
                  $sum: {
                    $cond: [{ $and: [{ $eq: ['$deadline.completed', false] }, { $lt: ['$deadline.dueDate', now] }] }, 1, 0]
                  }
                },
                dueToday: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$deadline.completed', false] },
                          {
                            $eq: [
                              { $dateToString: { date: '$deadline.dueDate', format: '%Y-%m-%d' } },
                              { $dateToString: { date: now, format: '%Y-%m-%d' } }
                            ]
                          }
                        ]
                      },
                      1,
                      0
                    ]
                  }
                },
                dueSoon: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$deadline.completed', false] },
                          { $gte: ['$deadline.dueDate', now] },
                          { $lte: ['$deadline.dueDate', new Date(now.getTime() + 7 * dayMs)] }
                        ]
                      },
                      1,
                      0
                    ]
                  }
                }
              }
            }
          ]
        } : {})
      }
    }
  ];

  const [result] = await Application.aggregate(pipeline);
  const total = result.totalCount?.[0]?.count || 0;

  const summary = includeSummary
    ? (result.summary?.[0] || { total: 0, overdue: 0, dueToday: 0, dueSoon: 0 })
    : undefined;

  return { data: result.data, total, summary };
}

const validateCommonQuery = [
  query('status').optional().isIn(['overdue', 'upcoming', 'completed', 'all']),
  query('type').optional().isIn(DEADLINE_TYPES),
  query('from').optional().isISO8601().toDate(),
  query('to').optional().isISO8601().toDate(),
  query('completed').optional().isBoolean().toBoolean(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('sortBy').optional().isIn(['dueDate']),
  query('order').optional().isIn(['asc', 'desc']),
  query('includeSummary').optional().isBoolean().toBoolean(),
];

// GET /api/deadlines (adviser/admin)
router.get(
  '/deadlines',
  requireRole('adviser', 'admin'),
  validateCommonQuery,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      status,
      type,
      from,
      to,
      completed,
      page = 1,
      limit = 20,
      sortBy = 'dueDate',
      order = 'asc',
      includeSummary = true
    } = req.query;

    const deadlineFilters = buildDeadlineFilters({
      status,
      type,
      from,
      to,
      completed: parseBool(completed, undefined)
    });

    const baseMatch = {};
    if (req.user.role === 'adviser') {
      baseMatch.adviserId = toObjectId(req.user._id);
    }
    // admin: no restriction

    try {
      const { data, total, summary } = await runDeadlineAggregation({
        baseMatch,
        deadlineFilters,
        page,
        limit,
        sortOrder: order === 'desc' ? -1 : 1,
        includeSummary
      });

      res.json({
        page,
        limit,
        total,
        summary,
        data
      });
    } catch (err) {
      // You may swap to your centralized error handler
      res.status(500).json({ message: 'Failed to fetch deadlines', error: err.message });
    }
  }
);

// GET /api/deadlines/client/:clientId (adviser/admin)
router.get(
  '/deadlines/client/:clientId',
  requireRole('adviser', 'admin'),
  [
    param('clientId').custom((val) => mongoose.Types.ObjectId.isValid(val)).withMessage('Invalid clientId'),
    ...validateCommonQuery
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const clientId = req.params.clientId;
    const {
      status,
      type,
      from,
      to,
      completed,
      page = 1,
      limit = 20,
      order = 'asc',
      includeSummary = true
    } = req.query;

    const deadlineFilters = buildDeadlineFilters({
      status,
      type,
      from,
      to,
      completed: parseBool(completed, undefined)
    });

    const baseMatch = { clientId: toObjectId(clientId) };

    try {
      if (req.user.role === 'adviser') {
        const count = await Application.countDocuments({
          clientId: toObjectId(clientId),
          adviserId: toObjectId(req.user._id)
        });
        if (count === 0) {
          return res.status(403).json({ message: 'You are not assigned to this client' });
        }
        baseMatch.adviserId = toObjectId(req.user._id);
      }

      const { data, total, summary } = await runDeadlineAggregation({
        baseMatch,
        deadlineFilters,
        page,
        limit,
        sortOrder: order === 'desc' ? -1 : 1,
        includeSummary
      });

      res.json({
        page,
        limit,
        total,
        summary,
        data
      });
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch client deadlines', error: err.message });
    }
  }
);

// GET /api/deadlines/me (client)
router.get(
  '/deadlines/me',
  requireRole('client'),
  validateCommonQuery,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      status,
      type,
      from,
      to,
      completed,
      page = 1,
      limit = 20,
      order = 'asc',
      includeSummary = true
    } = req.query;

    const deadlineFilters = buildDeadlineFilters({
      status,
      type,
      from,
      to,
      completed: parseBool(completed, undefined)
    });

    const baseMatch = { clientId: toObjectId(req.user._id) };

    try {
      const { data, total, summary } = await runDeadlineAggregation({
        baseMatch,
        deadlineFilters,
        page,
        limit,
        sortOrder: order === 'desc' ? -1 : 1,
        includeSummary
      });

      res.json({
        page,
        limit,
        total,
        summary,
        data
      });
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch your deadlines', error: err.message });
    }
  }
);

module.exports = router;



/**
 * @openapi
 * tags:
 *   - name: Deadlines
 *     description: Deadlines operations
 *
 * /api/deadlines:
 *   get:
 *     tags: [Deadlines]
 *     summary: List deadlines (adviser/admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [overdue, upcoming, completed, all]
 *         description: Filter by status; default excludes completed when not provided
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [rfi, ppi, medical, document]
 *         description: Filter by deadline type
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Include deadlines due on/after this date (ISO)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: Include deadlines due on/before this date (ISO)
 *       - in: query
 *         name: completed
 *         schema:
 *           type: boolean
 *         description: If provided, overrides status filter with explicit completed=true/false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 20
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [dueDate]
 *           default: dueDate
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *       - in: query
 *         name: includeSummary
 *         schema:
 *           type: boolean
 *           default: true
 *     responses:
 *       200:
 *         description: Deadlines returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeadlinesResponse'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       500: { description: Server error }
 *
 * /api/deadlines/client/{clientId}:
 *   get:
 *     tags: [Deadlines]
 *     summary: List deadlines for a specific client (adviser/admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [overdue, upcoming, completed, all]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [rfi, ppi, medical, document]
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: completed
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [dueDate], default: dueDate }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: includeSummary
 *         schema: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Client deadlines returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeadlinesResponse'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       500: { description: Server error }
 *
 * /api/deadlines/me:
 *   get:
 *     tags: [Deadlines]
 *     summary: List deadlines for the authenticated client
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [overdue, upcoming, completed, all]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [rfi, ppi, medical, document]
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: completed
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [dueDate], default: dueDate }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: includeSummary
 *         schema: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Client deadlines returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeadlinesResponse'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       500: { description: Server error }
 *
 * components:
 *   schemas:
 *     Deadline:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           enum: [rfi, ppi, medical, document]
 *         description:
 *           type: string
 *           nullable: true
 *         dueDate:
 *           type: string
 *           format: date-time
 *         completed:
 *           type: boolean
 *     DeadlineItem:
 *       type: object
 *       properties:
 *         applicationId:
 *           type: string
 *         clientId:
 *           type: string
 *         adviserId:
 *           type: string
 *           nullable: true
 *         visaType:
 *           type: string
 *           enum: [work, partner, student, residence, visitor, business]
 *         stage:
 *           type: string
 *           enum:
 *             - consultation
 *             - deposit_paid
 *             - documents_completed
 *             - additional_docs_required
 *             - submitted_to_inz
 *             - inz_processing
 *             - rfi_received
 *             - ppi_received
 *             - decision
 *         deadline:
 *           $ref: '#/components/schemas/Deadline'
 *         overdue:
 *           type: boolean
 *         daysRemaining:
 *           type: integer
 *           description: Days until due date (negative if overdue)
 *     DeadlinesSummary:
 *       type: object
 *       properties:
 *         total: { type: integer }
 *         overdue: { type: integer }
 *         dueToday: { type: integer }
 *         dueSoon: { type: integer }
 *     DeadlinesResponse:
 *       type: object
 *       properties:
 *         page: { type: integer }
 *         limit: { type: integer }
 *         total: { type: integer }
 *         summary:
 *           $ref: '#/components/schemas/DeadlinesSummary'
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DeadlineItem'
 */