-- Allow users to delete their own notifications.
-- The notifications table previously had INSERT / UPDATE / SELECT policies but
-- no DELETE policy, so the client could never remove a notification. This lets
-- us clear a user's notifications when they delete the associated Polaroid
-- (tapestry entry) and self-heal stale notifications that point at memories the
-- user has already removed.
CREATE POLICY "Users can delete own notifications"
    ON public.notifications
    FOR DELETE
    USING (auth.uid() = user_id);
