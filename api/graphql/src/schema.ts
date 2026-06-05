import {
  GraphQLBoolean,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { globalRegistry, defaultOntology, type EntityRecord } from "@daemon/ontology";
import { entityId, ontologyId } from "@daemon/platform-types";

/**
 * Minimal JSON scalar for entity property bags. Values pass through
 * unchanged; this keeps the schema honest about the dynamic shape of
 * ontology properties without inventing a per-ontology type.
 */
const GraphQLJSON = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value",
  serialize: (value) => value,
  parseValue: (value) => value,
});

const EntityType = new GraphQLObjectType({
  name: "Entity",
  fields: {
    entityId: { type: new GraphQLNonNull(GraphQLString) },
    ontologyId: { type: new GraphQLNonNull(GraphQLString) },
    version: { type: new GraphQLNonNull(GraphQLInt) },
    updatedAt: { type: new GraphQLNonNull(GraphQLString) },
    properties: { type: new GraphQLNonNull(GraphQLJSON) },
  },
});

/**
 * Read-only GraphQL surface over the ontology registry:
 *
 * - `entity(id, ontologyId)` resolves a single record (null when absent).
 * - `search(q, ontologyId)` enumerates records and filters on a substring
 *   match against the entity id and serialized properties.
 *
 * Both queries read the same {@link globalRegistry} the gateway uses, so the
 * GraphQL app stays consistent with REST/gRPC without duplicating state.
 */
export const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: {
      health: {
        type: new GraphQLNonNull(GraphQLBoolean),
        resolve: () => true,
      },
      entity: {
        type: EntityType,
        args: {
          id: { type: new GraphQLNonNull(GraphQLString) },
          ontologyId: { type: GraphQLString },
        },
        resolve: (_root, args: { id: string; ontologyId?: string }) => {
          const ont = ontologyId(args.ontologyId ?? defaultOntology());
          return globalRegistry.get(ont, entityId(args.id)) ?? null;
        },
      },
      search: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(EntityType))),
        args: {
          q: { type: new GraphQLNonNull(GraphQLString) },
          ontologyId: { type: GraphQLString },
        },
        resolve: (_root, args: { q: string; ontologyId?: string }) => {
          const ont = args.ontologyId ? ontologyId(args.ontologyId) : undefined;
          const needle = args.q.toLowerCase();
          return globalRegistry.list(ont).filter((record) => matches(record, needle));
        },
      },
    },
  }),
});

function matches(record: EntityRecord, needle: string): boolean {
  if (record.entityId.toLowerCase().includes(needle)) return true;
  return JSON.stringify(record.properties).toLowerCase().includes(needle);
}
