import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { toCsv } from "../lib/csv.js";
import { generateReportPdf } from "../lib/reportPdf.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

interface RevenueFilters {
  createdAt?: { gte?: Date; lte?: Date };
  assignedOfficerId?: string;
  pfaId?: string;
  pmbId?: string;
}

function parseRevenueFilters(req: import("express").Request): RevenueFilters {
  const where: RevenueFilters = {};
  const { from, to, officerId, pfaId, pmbId } = req.query;
  if (typeof from === "string" || typeof to === "string") {
    where.createdAt = {
      ...(typeof from === "string" ? { gte: new Date(from) } : {}),
      ...(typeof to === "string" ? { lte: new Date(to) } : {}),
    };
  }
  if (typeof officerId === "string") where.assignedOfficerId = officerId;
  if (typeof pfaId === "string") where.pfaId = pfaId;
  if (typeof pmbId === "string") where.pmbId = pmbId;
  return where;
}

async function computeRevenueReport(where: RevenueFilters) {
  const cases = await prisma.case.findMany({
    where,
    select: {
      id: true,
      status: true,
      active: true,
      feeTotal: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { name: true } },
      pfa: { select: { name: true } },
      pmb: { select: { name: true } },
      assignedOfficer: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const realized = cases.filter((c) => c.status === "CASE_CLOSED");
  const pipeline = cases.filter((c) => c.active);

  const sum = (list: typeof cases) => list.reduce((acc, c) => acc + (c.feeTotal ? Number(c.feeTotal) : 0), 0);

  const monthlyMap = new Map<string, number>();
  for (const c of realized) {
    const month = c.updatedAt.toISOString().slice(0, 7); // YYYY-MM
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + (c.feeTotal ? Number(c.feeTotal) : 0));
  }
  const monthlyTrend = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }));

  return {
    totalRealizedRevenue: sum(realized),
    totalPipelineValue: sum(pipeline),
    caseCount: cases.length,
    realizedCount: realized.length,
    pipelineCount: pipeline.length,
    monthlyTrend,
    cases: cases.map((c) => ({
      id: c.id,
      client: c.client.name,
      pfa: c.pfa.name,
      pmb: c.pmb.name,
      officer: c.assignedOfficer?.name ?? null,
      status: c.status,
      feeTotal: c.feeTotal,
      createdAt: c.createdAt,
      closedAt: c.status === "CASE_CLOSED" ? c.updatedAt : null,
    })),
  };
}

dashboardRouter.get("/revenue", requirePermission("dashboard:revenue"), async (req, res) => {
  const report = await computeRevenueReport(parseRevenueFilters(req));
  res.json(report);
});

dashboardRouter.get("/revenue/export", requirePermission("dashboard:revenue"), async (req, res) => {
  const report = await computeRevenueReport(parseRevenueFilters(req));
  const columns = ["Client", "PFA", "PMB", "Officer", "Status", "Fee Total", "Created", "Closed"];
  const rows = report.cases.map((c) => [
    c.client,
    c.pfa,
    c.pmb,
    c.officer ?? "",
    c.status,
    c.feeTotal ?? "",
    c.createdAt.toISOString().slice(0, 10),
    c.closedAt ? c.closedAt.toISOString().slice(0, 10) : "",
  ]);

  if (req.query.format === "pdf") {
    const pdf = await generateReportPdf({
      title: "Revenue Report",
      subtitle: `Realized: ${report.totalRealizedRevenue} | Pipeline: ${report.totalPipelineValue}`,
      columns,
      rows,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=revenue-report.pdf");
    res.send(Buffer.from(pdf));
    return;
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=revenue-report.csv");
  res.send(toCsv(columns, rows));
});

interface ActivityFilters {
  updatedAt?: { gte?: Date; lte?: Date };
}

function parseActivityFilters(req: import("express").Request): ActivityFilters {
  const { from, to } = req.query;
  if (typeof from !== "string" && typeof to !== "string") return {};
  return {
    updatedAt: {
      ...(typeof from === "string" ? { gte: new Date(from) } : {}),
      ...(typeof to === "string" ? { lte: new Date(to) } : {}),
    },
  };
}

async function computeActivityReport(dateFilter: ActivityFilters) {
  const opsOfficers = await prisma.user.findMany({ where: { role: "OPS_OFFICER" }, orderBy: { name: "asc" } });
  const customerCareAgents = await prisma.user.findMany({ where: { role: "CUSTOMER_CARE" }, orderBy: { name: "asc" } });

  const opsOfficerStats = await Promise.all(
    opsOfficers.map(async (officer) => {
      const casesAssigned = await prisma.case.count({ where: { assignedOfficerId: officer.id } });
      const closedCases = await prisma.case.findMany({
        where: { assignedOfficerId: officer.id, status: "CASE_CLOSED", ...dateFilter },
        select: { createdAt: true, updatedAt: true },
      });
      const avgDaysToClose =
        closedCases.length === 0
          ? null
          : closedCases.reduce((acc, c) => acc + (c.updatedAt.getTime() - c.createdAt.getTime()), 0) /
            closedCases.length /
            (1000 * 60 * 60 * 24);

      return {
        id: officer.id,
        name: officer.name,
        email: officer.email,
        lastLoginAt: officer.lastLoginAt,
        casesAssigned,
        casesClosed: closedCases.length,
        avgDaysToClose: avgDaysToClose === null ? null : Math.round(avgDaysToClose * 10) / 10,
      };
    }),
  );

  const customerCareStats = await Promise.all(
    customerCareAgents.map(async (agent) => {
      const complaintsResolved = await prisma.complaint.count({
        where: { resolvedById: agent.id, status: "RESOLVED", ...(dateFilter.updatedAt ? { updatedAt: dateFilter.updatedAt } : {}) },
      });
      return { id: agent.id, name: agent.name, email: agent.email, lastLoginAt: agent.lastLoginAt, complaintsResolved };
    }),
  );

  return { opsOfficers: opsOfficerStats, customerCareAgents: customerCareStats };
}

dashboardRouter.get("/activity", requirePermission("dashboard:activity"), async (req, res) => {
  const report = await computeActivityReport(parseActivityFilters(req));
  res.json(report);
});

dashboardRouter.get("/activity/export", requirePermission("dashboard:activity"), async (req, res) => {
  const report = await computeActivityReport(parseActivityFilters(req));
  const type = req.query.type === "customerCare" ? "customerCare" : "opsOfficers";

  const columns =
    type === "opsOfficers"
      ? ["Name", "Email", "Last Login", "Cases Assigned", "Cases Closed", "Avg Days to Close"]
      : ["Name", "Email", "Last Login", "Complaints Resolved"];

  const rows =
    type === "opsOfficers"
      ? report.opsOfficers.map((o) => [
          o.name,
          o.email,
          o.lastLoginAt ? o.lastLoginAt.toISOString() : "",
          o.casesAssigned,
          o.casesClosed,
          o.avgDaysToClose ?? "",
        ])
      : report.customerCareAgents.map((a) => [a.name, a.email, a.lastLoginAt ? a.lastLoginAt.toISOString() : "", a.complaintsResolved]);

  if (req.query.format === "pdf") {
    const pdf = await generateReportPdf({
      title: type === "opsOfficers" ? "Ops Officer Activity" : "Customer Care Activity",
      columns,
      rows,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=activity-report.pdf");
    res.send(Buffer.from(pdf));
    return;
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=activity-report.csv");
  res.send(toCsv(columns, rows));
});
