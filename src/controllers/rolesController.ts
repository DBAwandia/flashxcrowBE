// // controllers/userRoleController.ts
// import { Request, Response } from 'express';
// import User from '../models/User';
// import Role from '../models/Role';

// // Assign roles to user
// export const assignRolesToUser = async (req: Request, res: Response) => {
//   try {
//     const { userId } = req.params;
//     const { roleIds } = req.body;

//     // Validate input
//     if (!Array.isArray(roleIds) {
//       return res.status(400).json({ error: 'roleIds must be an array' });
//     }

//     // Check if user exists
//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({ error: 'User not found' });
//     }

//     // Check if all roles exist
//     const existingRoles = await Role.find({ _id: { $in: roleIds } });
//     if (existingRoles.length !== roleIds.length) {
//       return res.status(400).json({ error: 'One or more roles not found' });
//     }

//     // Assign roles (using $set to replace, $addToSet to add without duplicates)
//     user.roles = roleIds;
//     await user.save();

//     // Return user with populated roles
//     const updatedUser = await User.findById(userId).populate('roles');
//     res.json(updatedUser);
//   } catch (error) {
//     res.status(400).json({ error: error.message });
//   }
// };

// // Get user's roles
// export const getUserRoles = async (req: Request, res: Response) => {
//   try {
//     const { userId } = req.params;

//     const user = await User.findById(userId).populate('roles');
//     if (!user) {
//       return res.status(404).json({ error: 'User not found' });
//     }

//     res.json(user.roles);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// };

// // Update user's roles (add new ones)
// export const addRolesToUser = async (req: Request, res: Response) => {
//   try {
//     const { userId } = req.params;
//     const { roleIds } = req.body;

//     if (!Array.isArray(roleIds)) {
//       return res.status(400).json({ error: 'roleIds must be an array' });
//     }

//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({ error: 'User not found' });
//     }

//     const existingRoles = await Role.find({ _id: { $in: roleIds } });
//     if (existingRoles.length !== roleIds.length) {
//       return res.status(400).json({ error: 'One or more roles not found' });
//     }

//     // Add new roles without duplicates
//     const newRoles = [...new Set([...user.roles, ...roleIds])];
//     user.roles = newRoles;
//     await user.save();

//     const updatedUser = await User.findById(userId).populate('roles');
//     res.json(updatedUser);
//   } catch (error) {
//     res.status(400).json({ error: error.message });
//   }
// };

// // Remove roles from user
// export const removeRolesFromUser = async (req: Request, res: Response) => {
//   try {
//     const { userId } = req.params;
//     const { roleIds } = req.body;

//     if (!Array.isArray(roleIds)) {
//       return res.status(400).json({ error: 'roleIds must be an array' });
//     }

//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({ error: 'User not found' });
//     }

//     // Filter out the roles to remove
//     user.roles = user.roles.filter(
//       (roleId) => !roleIds.includes(roleId.toString())
//     );
//     await user.save();

//     const updatedUser = await User.findById(userId).populate('roles');
//     res.json(updatedUser);
//   } catch (error) {
//     res.status(400).json({ error: error.message });
//   }
// };