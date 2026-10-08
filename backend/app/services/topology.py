from __future__ import annotations

from app.domain.models import MeterNode, NodeKind


def children(nodes: dict[str, MeterNode], node_id: str) -> list[MeterNode]:
    return [n for n in nodes.values() if n.parent_id == node_id]


def descendants(nodes: dict[str, MeterNode], node_id: str) -> list[MeterNode]:
    out: list[MeterNode] = []
    stack = children(nodes, node_id)
    while stack:
        current = stack.pop()
        out.append(current)
        stack.extend(children(nodes, current.id))
    return out


def topology_tree(nodes: dict[str, MeterNode]) -> list[dict]:
    roots = [n for n in nodes.values() if n.parent_id is None]

    def walk(node: MeterNode) -> dict:
        return {
            "id": node.id,
            "label": node.label,
            "kind": node.kind.value,
            "buffered": node.buffered,
            "children": [walk(c) for c in children(nodes, node.id)],
        }

    return [walk(root) for root in roots]


def direct_measured_children(nodes: dict[str, MeterNode], node_id: str) -> list[MeterNode]:
    return [c for c in children(nodes, node_id) if c.kind == NodeKind.METER]
