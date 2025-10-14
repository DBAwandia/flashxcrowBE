// // routes/userRoleRoutes.ts
// import express from 'express';
// import {
//   assignRolesToUser,
//   getUserRoles,
//   addRolesToUser,
//   removeRolesFromUser,
// } from '../controllers/userRoleController';
// import { authenticate } from '../middleware/authMiddleware';
// import { checkPermission } from '../middleware/permissionMiddleware';

// const router = express.Router();

// // Assign/replace all roles for a user
// router.post(
//   '/:userId/roles',
//   authenticate,
//   checkPermission('manage_user_roles'),
//   assignRolesToUser
// );

// // Get user's roles
// router.get(
//   '/:userId/roles',
//   authenticate,
//   checkPermission('view_user_roles'),
//   getUserRoles
// );

// // Add roles to user
// router.patch(
//   '/:userId/roles/add',
//   authenticate,
//   checkPermission('manage_user_roles'),
//   addRolesToUser
// );

// // Remove roles from user
// router.patch(
//   '/:userId/roles/remove',
//   authenticate,
//   checkPermission('manage_user_roles'),
//   removeRolesFromUser
// );

// export default router;