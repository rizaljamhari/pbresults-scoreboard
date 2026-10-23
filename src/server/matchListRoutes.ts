import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppChangedEventType } from "../shared/appEvents.js";
import { scheduledGameSchema, seriesOrderValues, teamMappingRequestSchema } from "../shared/matchList.js";
import { MatchListError, applyTeamMapping, createMatchList, deleteMatchList, setActiveMatchList, updateMatchList } from "./matchLists.js";
import { SchedulePdfError, parseSchedulePdf } from "./schedulePdf.js";
import { getMatchListsState } from "./storage.js";

type MatchListRouteOptions = {
  hub: { publish: (type: AppChangedEventType, resourceIds?: string[]) => unknown };
  /** Called after team records change, so live team resolution sees new or reactivated teams. */
  onTeamsChanged?: () => void;
};

const listBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  sourceFileName: z.string().max(200).nullable().optional(),
  games: z.array(scheduledGameSchema).max(500),
  seriesOrder: z.record(z.enum(seriesOrderValues)).optional()
});

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof MatchListError) return reply.code(error.statusCode).send({ message: error.message });
  if (error instanceof z.ZodError) return reply.code(400).send({ message: "Invalid match list", issues: error.issues });
  throw error;
}

export function registerMatchListRoutes(app: FastifyInstance, options: MatchListRouteOptions) {
  const changed = (ids?: string[]) => options.hub.publish("match-lists.changed", ids);

  app.get("/api/match-lists", async () => getMatchListsState());

  // Reads a schedule PDF and returns its games. Nothing is saved until the list is created.
  app.post("/api/match-lists/import", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Missing file" });
    const isPdf = file.mimetype === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      file.file.resume();
      return reply.code(415).send({ message: "Upload the schedule as a PDF." });
    }
    try {
      const schedule = await parseSchedulePdf(await file.toBuffer());
      return { ...schedule, sourceFileName: file.filename };
    } catch (error) {
      if (error instanceof SchedulePdfError) return reply.code(422).send({ message: error.message });
      throw error;
    }
  });

  app.post("/api/match-lists", async (request, reply) => {
    try {
      const list = createMatchList(listBodySchema.parse(request.body));
      changed([list.id]);
      return reply.code(201).send(list);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put("/api/match-lists/active", async (request, reply) => {
    try {
      const { listId } = z.object({ listId: z.string().min(1).nullable() }).parse(request.body);
      const state = setActiveMatchList(listId);
      changed();
      return state;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put("/api/match-lists/:id", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const list = updateMatchList(id, listBodySchema.parse(request.body));
      changed([list.id]);
      return list;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete("/api/match-lists/:id", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      deleteMatchList(id);
      changed([id]);
      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/match-lists/:id/team-mapping", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const { list, changedTeamIds } = applyTeamMapping(id, teamMappingRequestSchema.parse(request.body));
      changed([list.id]);
      if (changedTeamIds.length > 0) {
        options.onTeamsChanged?.();
        options.hub.publish("teams.changed", changedTeamIds);
      }
      return list;
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
