// Emits draw.io XML in the AWS reference-architecture style: official AWS4 icons, AWS Cloud / Region / VPC / subnet
// groups. Two looks: category-tinted 120x120 containers with teal step badges and a right-hand legend (service, badge,
// legend), or bare icons with SRA-style "n.m" index badges whose legend is the README (icon, num, titleBlock: false).
// Usage: import { diagram } from './drawio.mjs' and write the returned XML to <name>.drawio.
// Export to PNG/SVG with export.mjs (headless draw.io in a container).

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = (s) => esc(s); // values are HTML-in-attribute: callers pass markup, we escape once

const FONT = 'fontFamily=Helvetica;';
const POINTS16 = 'points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];';
const GROUP_POINTS = 'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];';

// Service categories: container tint, stroke, icon fill.
export const CAT = {
  networking: { tint: '#EDE7F6', stroke: '#8C4FFF' },
  compute: { tint: '#FFF2E8', stroke: '#ED7100' },
  security: { tint: '#FFEBEE', stroke: '#DD344C' },
  storage: { tint: '#E8F5E9', stroke: '#3F8624' },
  aiml: { tint: '#E0F2F1', stroke: '#01A88D' },
  integration: { tint: '#FCE4EC', stroke: '#E7157B' },
  containers: { tint: '#FFF2E8', stroke: '#ED7100' },
  general: { tint: '#F5F5F5', stroke: '#666666' },
};

// Group boundary types with the authoritative AWS colors.
const GROUPS = {
  awsCloud: { icon: 'group_aws_cloud', stroke: '#232F3E', fill: 'light-dark(#232F3E0D,#232F3E0D)', dashed: 0, fontSize: 12, bold: 0, container: 0 },
  region: { icon: 'group_region', stroke: '#00A4A6', fill: 'light-dark(#0C7B7D0D,#0C7B7D0D)', dashed: 1, fontSize: 14, bold: 1, container: 0 },
  vpc: { icon: 'group_vpc2', stroke: '#8C4FFF', fill: 'light-dark(#8C4FFF0D,#8C4FFF0D)', dashed: 0, fontSize: 12, bold: 0, container: 0 },
  privateSubnet: { icon: 'group_private_subnet', stroke: '#147EBA', fill: 'light-dark(#147EBA0D,#147EBA0D)', dashed: 0, fontSize: 12, bold: 0, container: 0 },
  publicSubnet: { icon: 'group_public_subnet', stroke: '#248814', fill: 'light-dark(#2488140D,#2488140D)', dashed: 0, fontSize: 12, bold: 0, container: 0 },
  securityGroup: { icon: 'group_security_group', stroke: '#DD3522', fill: 'none', dashed: 0, fontSize: 12, bold: 0, container: 0 },
  generic: { icon: null, stroke: '#7D8998', fill: 'none', dashed: 1, fontSize: 12, bold: 0, container: 0 },
  // The CloudFront edge: global, so outside any Region. Drawn in the CloudFront purple.
  edge: { icon: null, stroke: '#8C4FFF', fill: 'none', dashed: 0, fontSize: 14, bold: 1, container: 0 },
};

export const NODE = 120; // container size; icon is 48x48 at (36, 30)
export const ICON = 56; // bare icon size (SRA style); its label sits underneath

export function diagram({ name, title, subtitle, width, height, build, titleBlock = true }) {
  const cells = [];
  let n = 0;
  const id = (p) => `${p}-${++n}`;
  const cell = (s) => cells.push(s);

  // Title block
  const titleW = width - 80;
  if (titleBlock) {
    cell(`<mxCell id="title-group" connectable="0" style="group;${FONT}" value="" vertex="1" parent="1"><mxGeometry height="83" width="${titleW}" x="40" y="30" as="geometry" /></mxCell>`);
    cell(`<mxCell id="title-text" style="text;html=1;resizable=1;points=[];autosize=1;align=left;verticalAlign=top;spacingTop=-4;fontSize=30;fontStyle=1;${FONT}" value="${html(title)}" vertex="1" parent="title-group"><mxGeometry height="42" width="${titleW - 100}" as="geometry" /></mxCell>`);
    cell(`<mxCell id="subtitle-text" style="text;html=1;resizable=0;points=[];autosize=1;align=left;verticalAlign=top;spacingTop=-4;fontSize=16;${FONT}" value="${html(subtitle)}" vertex="1" parent="title-group"><mxGeometry height="25" width="${titleW - 100}" x="5" y="40" as="geometry" /></mxCell>`);
    cell(`<mxCell id="title-separator" style="line;strokeWidth=2;html=1;fontSize=14;strokeColor=#FF9900;${FONT}" value="" vertex="1" parent="title-group"><mxGeometry height="10" width="${titleW - 10}" x="5" y="70" as="geometry" /></mxCell>`);
  }

  const api = {
    // A group boundary. Returns its id; children of container groups use coordinates relative to it.
    // `num` ("1.0") puts an SRA-style index badge under the group's icon at its top-left corner.
    group(type, label, { x, y, w, h, parent = '1', num }) {
      const g = GROUPS[type];
      const gid = id(type);
      const icon = g.icon ? `shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.${g.icon};spacingLeft=30;` : `rounded=0;${num ? 'spacingLeft=30;' : ''}`;
      cell(`<mxCell id="${gid}" style="${GROUP_POINTS}outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=${g.fontSize};fontStyle=${g.bold};${icon}strokeColor=${g.stroke};fillColor=${g.fill};fillStyle=auto;verticalAlign=top;align=left;fontColor=${g.stroke};dashed=${g.dashed};container=${g.container};pointerEvents=0;collapsible=0;recursiveResize=0;${FONT}" value="${html(label)}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" /></mxCell>`);
      if (num) api.num(num, x - 6, y + (g.icon ? 30 : 4));
      return gid;
    },
    // A service: tinted container (category label) with a 48x48 icon (service name + italic sublabel). Returns the icon id.
    service({ key, cat, category, label, sub, shape, resource = false, x, y, parent = '1' }) {
      const c = CAT[cat];
      const cid = `svc-group-${key}`;
      const iid = `svc-${key}`;
      cell(`<mxCell id="${cid}" style="fillColor=${c.tint};strokeColor=${c.stroke};rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;fontStyle=1;fontSize=12;fontColor=${c.stroke};${FONT}container=1;collapsible=0;shadow=1;strokeWidth=1.5;" value="${html(category)}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${NODE}" height="${NODE}" as="geometry" /></mxCell>`);
      const value = sub ? `${label}<div><i>${sub}</i></div>` : label;
      const style = resource
        ? `sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=${c.stroke};strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.${shape};${FONT}`
        : `sketch=0;${POINTS16}outlineConnect=0;fontColor=#232F3E;fillColor=${c.stroke};strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${shape};${FONT}shadow=1;`;
      cell(`<mxCell id="${iid}" style="${style}" value="${html(value)}" vertex="1" parent="${cid}"><mxGeometry x="36" y="30" width="48" height="48" as="geometry" /></mxCell>`);
      return iid;
    },
    // An external actor (client, user). Edges connect to the container. Returns the container id.
    actor({ key, label, sub, shape = 'client', x, y }) {
      const cid = `actor-${key}`;
      cell(`<mxCell id="${cid}" style="fillColor=#f5f5f5;strokeColor=light-dark(#666666,#D4D4D4);rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;fontStyle=1;fontSize=12;fontColor=#333333;${FONT}container=1;collapsible=0;shadow=1;strokeWidth=1;perimeterSpacing=0;" value="${html(label)}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${NODE}" height="${NODE}" as="geometry" /></mxCell>`);
      cell(`<mxCell id="${cid}-icon" style="sketch=0;${POINTS16}outlineConnect=0;fontColor=#232F3E;fillColor=#232F3D;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${shape};${FONT}" value="${html(sub ? `<i>${sub}</i>` : '')}" vertex="1" parent="${cid}"><mxGeometry x="36" y="30" width="48" height="48" as="geometry" /></mxCell>`);
      return cid;
    },
    // A bare AWS icon (SRA style): ICON x ICON, category colour, label and italic sublabel underneath, no container.
    // `num` ("1.2") puts an index badge on its top-left corner. Returns the icon id; edges connect to it.
    // `image` (an SVG string) draws that instead of an AWS shape, for non-AWS parties such as the MCP client.
    icon({ key, cat = 'general', label, sub, shape, image, resource = false, x, y, parent = '1', num }) {
      const c = CAT[cat];
      const iid = `icon-${key}`;
      const value = sub ? `${label}<div><i>${sub}</i></div>` : label;
      const style = image
        ? `shape=image;imageAspect=1;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontColor=#232F3E;fontSize=12;fontStyle=0;${FONT}image=data:image/svg+xml,${Buffer.from(image).toString('base64')};`
        : resource
          ? `sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=${c.stroke};strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.${shape};${FONT}`
          : `sketch=0;${POINTS16}outlineConnect=0;fontColor=#232F3E;fillColor=${c.stroke};strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${shape};${FONT}`;
      cell(`<mxCell id="${iid}" style="${style}" value="${html(value)}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${ICON}" height="${ICON}" as="geometry" /></mxCell>`);
      if (num) api.num(num, x - 14, y - 14);
      return iid;
    },
    // An SRA-style index badge: black circle, white "n.m", at absolute coordinates (its top-left).
    num(value, x, y) {
      cell(`<mxCell id="num-${String(value).replace('.', '-')}" style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#000000;strokeColor=#000000;fontColor=#FFFFFF;fontStyle=1;fontSize=11;${FONT}" value="${value}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="28" height="28" as="geometry" /></mxCell>`);
    },
    // A plain text label.
    text(value, { x, y, w, h = 20, color = '#232F3E', size = 12, bold = false, parent = '1', align = 'center' }) {
      cell(`<mxCell id="${id('text')}" value="${html(value)}" style="text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;align=${align};verticalAlign=middle;fontSize=${size};fontStyle=${bold ? 1 : 0};fontColor=${color};${FONT}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" /></mxCell>`);
    },
    // An edge between two cells. exit/entry are [x,y] in 0..1. label sits at `at` along the edge (-1..1), offset dy px.
    edge(source, target, { exit = [1, 0.5], entry = [0, 0.5], label, at = 0, dy = 28, dx = 0, color = '#545B64', dashed = false, both = false, elbow = 'horizontal', points = [] } = {}) {
      const eid = id('e');
      const start = both ? 'startArrow=block;startFill=1;' : 'startArrow=none;';
      cell(`<mxCell id="${eid}" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=block;elbow=${elbow};${start}endFill=1;strokeColor=${color};${dashed ? 'dashed=1;' : ''}rounded=0;exitX=${exit[0]};exitY=${exit[1]};entryX=${entry[0]};entryY=${entry[1]};${FONT}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry">${points.length ? `<Array as="points">${points.map(([px, py]) => `<mxPoint x="${px}" y="${py}" />`).join('')}</Array>` : ''}</mxGeometry></mxCell>`);
      if (label) {
        cell(`<mxCell id="${eid}-label" value="${html(label)}" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];labelBackgroundColor=none;fontSize=11;fontColor=${color};${FONT}" connectable="0" vertex="1" parent="${eid}"><mxGeometry relative="1" x="${at}" y="0" as="geometry"><mxPoint x="${dx}" y="${dy}" as="offset" /></mxGeometry></mxCell>`);
      }
      return eid;
    },
    // A numbered teal badge at absolute coordinates (its top-left).
    badge(num, x, y) {
      cell(`<mxCell id="step-${num}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#007CBD;strokeColor=default;fontColor=#FFFFFF;fontStyle=1;fontSize=16;${FONT}shadow=1;glass=0;strokeWidth=2;align=center;verticalAlign=middle;labelBackgroundColor=none;" value="${num}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="28" height="28" as="geometry" /></mxCell>`);
    },
    // The right-hand step legend: [{ title, text }] in step order.
    legend(steps, { x, y = 30, w = 620 }) {
      const textW = w - 92;
      const rowH = (s) => 24 + Math.ceil((s.text.length * 7.2) / textW) * 18 + 14; // title + wrapped lines + gap
      const ys = steps.reduce((acc, s, i) => [...acc, acc[i] + rowH(s)], [0]);
      const h = Math.max(ys[steps.length] + 50, 300);
      cell(`<mxCell id="legend-bg" style="verticalLabelPosition=bottom;verticalAlign=top;html=1;shape=mxgraph.basic.rect;fillColor2=none;strokeWidth=1;size=20;indent=5;fillColor=light-dark(#EDF3FF,#305363);strokeColor=#6c8ebf;" value="" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" /></mxCell>`);
      cell(`<mxCell id="legend-container" connectable="0" style="group" value="" vertex="1" parent="1"><mxGeometry x="${x + 20}" y="${y + 25}" width="${w - 40}" height="${h - 40}" as="geometry" /></mxCell>`);
      steps.forEach((s, i) => {
        const k = i + 1;
        cell(`<mxCell id="step-${k}-legend" connectable="0" style="group;${FONT}" value="" vertex="1" parent="legend-container"><mxGeometry height="${rowH(s)}" width="${w - 40}" x="0" y="${ys[i]}" as="geometry" /></mxCell>`);
        cell(`<mxCell id="step-${k}-badge-legend" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#007CBD;strokeColor=default;fontColor=#FFFFFF;fontStyle=1;fontSize=22;labelBackgroundColor=none;${FONT}shadow=1;glass=0;strokeWidth=2;" value="${k}" vertex="1" parent="step-${k}-legend"><mxGeometry height="38" width="40" y="2" as="geometry" /></mxCell>`);
        const v = `<div><b>${s.title}</b></div><div><span style="color: light-dark(rgb(0,0,0), rgb(255,255,255));">${s.text}</span></div>`;
        cell(`<mxCell id="step-${k}-desc-legend" style="text;html=1;align=left;verticalAlign=top;spacingTop=-4;fontSize=14;labelBackgroundColor=none;whiteSpace=wrap;${FONT}" value="${html(v)}" vertex="1" parent="step-${k}-legend"><mxGeometry height="${rowH(s)}" width="${textW}" x="52" as="geometry" /></mxCell>`);
      });
      return h;
    },
  };

  build(api);

  return `<mxfile host="Electron" version="29.6.1">
  <diagram name="${esc(name)}" id="${esc(name)}">
    <mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${width}" pageHeight="${height}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}
