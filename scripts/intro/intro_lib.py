"""Shared Blender helpers for the intro scene scripts (materials, primitives, easing)."""
import math
import os
import random
import sys

import bpy
from mathutils import Vector
# ----------------------------------------------------------------- helpers
def lin(hexstr, a=1.0):
    hexstr = hexstr.lstrip("#")
    out = []
    for k in range(3):
        c = int(hexstr[2 * k:2 * k + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, a)


def set_in(node, names, value):
    for n in names if isinstance(names, (list, tuple)) else [names]:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return node.inputs[n]
    return None


def material(name, color, rough=0.4, metal=0.0, coat=0.0, emit=None, strength=0.0, spec=0.5, coat_rough=0.05):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    set_in(b, "Base Color", lin(color))
    set_in(b, "Roughness", rough)
    set_in(b, "Metallic", metal)
    set_in(b, ["Coat Weight", "Clearcoat"], coat)
    set_in(b, ["Coat Roughness", "Clearcoat Roughness"], coat_rough)
    set_in(b, ["Specular IOR Level", "Specular"], spec)
    if emit:
        set_in(b, ["Emission Color", "Emission"], lin(emit))
        set_in(b, "Emission Strength", strength)
    return m


def noisy(m, scale=18.0, rough_lo=0.3, rough_hi=0.7, bump=0.15, color2=None, coords="Object"):
    """Adds procedural roughness variation, bump and optional colour variation."""
    t = m.node_tree
    b = t.nodes["Principled BSDF"]
    tc = t.nodes.new("ShaderNodeTexCoord")
    nz = t.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 8.0
    t.links.new(tc.outputs[coords], nz.inputs["Vector"])
    mr = t.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = rough_lo
    mr.inputs["To Max"].default_value = rough_hi
    t.links.new(nz.outputs["Fac"], mr.inputs["Value"])
    t.links.new(mr.outputs["Result"], b.inputs["Roughness"])
    if bump > 0:
        fine = t.nodes.new("ShaderNodeTexNoise")
        fine.inputs["Scale"].default_value = scale * 9
        fine.inputs["Detail"].default_value = 4.0
        t.links.new(tc.outputs[coords], fine.inputs["Vector"])
        bn = t.nodes.new("ShaderNodeBump")
        bn.inputs["Strength"].default_value = bump
        t.links.new(fine.outputs["Fac"], bn.inputs["Height"])
        t.links.new(bn.outputs["Normal"], b.inputs["Normal"])
    if color2:
        mix = t.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs[6].default_value = b.inputs["Base Color"].default_value
        mix.inputs[7].default_value = lin(color2)
        t.links.new(nz.outputs["Fac"], mix.inputs[0])
        t.links.new(mix.outputs[2], b.inputs["Base Color"])
    return m


def stripes(m, color_a, color_b, scale=4.0, axis="Y", coords="Object"):
    """Hard two-colour stripes along one axis (boom pole, hazard ends)."""
    t = m.node_tree
    b = t.nodes["Principled BSDF"]
    tc = t.nodes.new("ShaderNodeTexCoord")
    sep = t.nodes.new("ShaderNodeSeparateXYZ")
    t.links.new(tc.outputs[coords], sep.inputs[0])
    mul = t.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = scale
    t.links.new(sep.outputs[axis], mul.inputs[0])
    fr = t.nodes.new("ShaderNodeMath"); fr.operation = "FRACT"
    t.links.new(mul.outputs[0], fr.inputs[0])
    gt = t.nodes.new("ShaderNodeMath"); gt.operation = "GREATER_THAN"; gt.inputs[1].default_value = 0.5
    t.links.new(fr.outputs[0], gt.inputs[0])
    mix = t.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs[6].default_value = lin(color_a)
    mix.inputs[7].default_value = lin(color_b)
    t.links.new(gt.outputs[0], mix.inputs[0])
    t.links.new(mix.outputs[2], b.inputs["Base Color"])
    return m


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def set_parent(child, parent):
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def rbox(name, size, loc, mat, bevel=0.05, seg=3, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    for v in o.data.vertices:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    o.location = loc
    o.rotation_euler = rot
    if bevel > 0:
        b = o.modifiers.new("Bevel", "BEVEL")
        b.width = min(bevel, min(size) * 0.49)
        b.segments = seg
        b.limit_method = "NONE"
        try:
            b.harden_normals = True
        except Exception:
            pass
    smooth(o)
    o.data.materials.append(mat)
    if parent:
        set_parent(o, parent)
    return o


def cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=48, parent=None, bevel=0.02):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    smooth(o)
    if bevel:
        b = o.modifiers.new("Bevel", "BEVEL")
        b.width = min(bevel, r * 0.3)
        b.segments = 3
        b.limit_method = "ANGLE"
    o.data.materials.append(mat)
    if parent:
        set_parent(o, parent)
    return o


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    link(o)
    if parent:
        set_parent(o, parent)
    return o


def text_obj(name, body, size, mat, font_path=None, extrude=0.01):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    if font_path and os.path.exists(font_path):
        cu.font = bpy.data.fonts.load(font_path, check_existing=True)
    o = bpy.data.objects.new(name, cu)
    o.data.materials.append(mat)
    link(o)
    return o


def mesh_from(name, verts, faces, mat, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                layer.data[li].uv = uvs[me.loops[li].vertex_index]
    o = bpy.data.objects.new(name, me)
    o.data.materials.append(mat)
    smooth(o)
    link(o)
    return o


def key(obj, path, frame, index=-1):
    obj.keyframe_insert(data_path=path, frame=frame, index=index)


def smoothstep(e0, e1, x):
    x = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return x * x * (3 - 2 * x)


def ease_out_back(x, s=1.2):
    x = max(0.0, min(1.0, x))
    return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2


def monotone(keys):
    ts = [k[0] for k in keys]
    vs = [k[1] for k in keys]
    n = len(keys)
    d = [(vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]) for i in range(n - 1)]
    m = [d[0]] + [(d[i - 1] + d[i]) / 2 if d[i - 1] * d[i] > 0 else 0.0 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0.0
        else:
            a, b = m[i] / d[i], m[i + 1] / d[i]
            h = a * a + b * b
            if h > 9:
                tau = 3 / math.sqrt(h)
                m[i], m[i + 1] = tau * a * d[i], tau * b * d[i]

    def f(t):
        if t <= ts[0]:
            return vs[0]
        if t >= ts[-1]:
            return vs[-1]
        i = max(j for j in range(n - 1) if ts[j] <= t)
        hh = ts[i + 1] - ts[i]
        u = (t - ts[i]) / hh
        return ((2 * u ** 3 - 3 * u ** 2 + 1) * vs[i] + (u ** 3 - 2 * u ** 2 + u) * hh * m[i]
                + (-2 * u ** 3 + 3 * u ** 2) * vs[i + 1] + (u ** 3 - u ** 2) * hh * m[i + 1])

    return f


def vec_keys(keys):
    comps = [monotone([(t, v[c]) for t, v in keys]) for c in range(len(keys[0][1]))]
    return lambda t: Vector([c(t) for c in comps])


def glow_material(name, color, strength=6.0):
    """Emission blended with transparency by a factor (beams, rings)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    for n in list(t.nodes):
        t.nodes.remove(n)
    out = t.nodes.new("ShaderNodeOutputMaterial")
    mix = t.nodes.new("ShaderNodeMixShader")
    tr = t.nodes.new("ShaderNodeBsdfTransparent")
    em = t.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin(color)
    em.inputs["Strength"].default_value = strength
    mix.inputs[0].default_value = 0.0
    t.links.new(tr.outputs[0], mix.inputs[1])
    t.links.new(em.outputs[0], mix.inputs[2])
    t.links.new(mix.outputs[0], out.inputs["Surface"])
    return m, mix


def spot(name, loc, energy, color, size_deg, blend=0.4, rot=(0, 0, 0), radius=0.05, parent=None):
    ld = bpy.data.lights.new(name, "SPOT")
    ld.energy = energy
    ld.color = lin(color)[:3]
    ld.spot_size = math.radians(size_deg)
    ld.spot_blend = blend
    ld.shadow_soft_size = radius
    o = bpy.data.objects.new(name, ld)
    link(o)
    o.location = loc
    o.rotation_euler = rot
    if parent:
        set_parent(o, parent)
    return o



# ------------------------------------------------------------ PBR from disk
TEX_ROOT = [""]


def tex_path(tid, kind):
    d = os.path.join(TEX_ROOT[0], "tex", tid)
    for f in os.listdir(d):
        if f"_{kind}_" in f:
            return os.path.join(d, f)
    return None


def pbr(name, tid, scale, coords="Object", tint=None, rough_mul=1.0, bump=1.0, macro=0.0, macro_scale=0.03):
    """Image-texture material from a Poly Haven texture set (Diffuse/AO/Rough/nor_gl).
    coords="UV" maps flat (UV in metres); otherwise box projection on object coords.
    macro adds large-scale brightness variation so tiling never shows from the air."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    b = t.nodes["Principled BSDF"]
    if coords == "UV":
        src = t.nodes.new("ShaderNodeUVMap").outputs["UV"]
    else:
        src = t.nodes.new("ShaderNodeTexCoord").outputs[coords]
    mp = t.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    t.links.new(src, mp.inputs["Vector"])

    def img(kind, non_color):
        p = tex_path(tid, kind)
        if not p:
            return None
        n = t.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(p, check_existing=True)
        if non_color:
            n.image.colorspace_settings.name = "Non-Color"
        if coords != "UV":
            n.projection = "BOX"
            n.projection_blend = 0.25
        t.links.new(mp.outputs["Vector"], n.inputs["Vector"])
        return n

    col = img("Diffuse", False).outputs["Color"]
    ao = img("AO", True)
    if ao:
        mul = t.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"
        mul.inputs[0].default_value = 0.8
        t.links.new(col, mul.inputs[6]); t.links.new(ao.outputs["Color"], mul.inputs[7])
        col = mul.outputs[2]
    if tint:
        tm = t.nodes.new("ShaderNodeMix"); tm.data_type = "RGBA"; tm.blend_type = "MULTIPLY"
        tm.inputs[0].default_value = 1.0
        tm.inputs[7].default_value = lin(tint)
        t.links.new(col, tm.inputs[6])
        col = tm.outputs[2]
    if macro > 0:
        col = macro_var(t, src, col, macro, macro_scale)
    t.links.new(col, b.inputs["Base Color"])
    ro = img("Rough", True)
    if ro:
        rm = t.nodes.new("ShaderNodeMath"); rm.operation = "MULTIPLY"; rm.inputs[1].default_value = rough_mul; rm.use_clamp = True
        t.links.new(ro.outputs["Color"], rm.inputs[0])
        t.links.new(rm.outputs[0], b.inputs["Roughness"])
    nm = img("nor_gl", True)
    if nm and bump > 0:
        nn = t.nodes.new("ShaderNodeNormalMap"); nn.inputs["Strength"].default_value = bump
        t.links.new(nm.outputs["Color"], nn.inputs["Color"])
        t.links.new(nn.outputs["Normal"], b.inputs["Normal"])
    set_in(b, ["Specular IOR Level", "Specular"], 0.4)
    return m


def macro_var(t, src, col, amount, scale):
    """Multiplies a colour by slow noise (1 +/- amount)."""
    nz = t.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 3.0
    t.links.new(src, nz.inputs["Vector"])
    mr = t.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.3
    mr.inputs["From Max"].default_value = 0.7
    mr.inputs["To Min"].default_value = 1 - amount
    mr.inputs["To Max"].default_value = 1 + amount
    t.links.new(nz.outputs["Fac"], mr.inputs["Value"])
    mx = t.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"
    mx.inputs[0].default_value = 1.0
    t.links.new(col, mx.inputs[6])
    t.links.new(mr.outputs["Result"], mx.inputs[7])
    return mx.outputs[2]
