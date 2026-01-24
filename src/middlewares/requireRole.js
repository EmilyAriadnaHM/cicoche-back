module.exports = function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const raw = Array.isArray(req.user?.roles) ? req.user.roles : [];
    console.log("REQ.USER", req.user);
    console.log("REQ.USER.ROLES", req.user?.roles);


    const roleNames = raw
      .map((r) => {
        if (typeof r === "string") return r;
        return r?.role?.name || r?.name || null;
      })
      .filter(Boolean);

    // ADMIN tiene paso total
    if (roleNames.includes("ADMIN")) return next();

    const ok = allowedRoles.some((r) => roleNames.includes(r));
    if (!ok) return res.status(403).json({ error: "No autorizado" });

    next();
  };
};

module.exports = function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];

    if (roles.includes("ADMIN")) return next();

    const ok = roles.some((r) => allowedRoles.includes(r));
    if (!ok) return res.status(403).json({ error: "No autorizado" });

    next();
  };
};

