// SPDX-License-Identifier: GPL-3.0-only
package tvbox.config;
import java.io.*;
import java.nio.channels.*;
import java.nio.file.*;
/** Kernel advisory locks survive PID namespaces and are released on process exit.
 * Lock inodes are permanent: unlinking a locked inode would permit a second owner.
 */
public final class DirectoryLease {
 public static void main(String[] args)throws Exception {
  Path root=Path.of(args[0]);Files.createDirectories(root);
  try(FileChannel owner=FileChannel.open(root.resolve(".lease"),StandardOpenOption.CREATE,StandardOpenOption.READ,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);
      FileChannel users=FileChannel.open(root.resolve(".users"),StandardOpenOption.CREATE,StandardOpenOption.READ,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)) {
   FileLock ownership=owner.tryLock();
   if(ownership==null){System.out.println("BUSY");return;}
   try(ownership){
    FileLock check=users.tryLock();
    if(check==null){System.out.println("IN_USE");return;}
    check.release();
    try(FileLock shared=users.lock(0,Long.MAX_VALUE,true)) {
     System.out.println("READY");System.out.flush();
     BufferedReader input=new BufferedReader(new InputStreamReader(System.in));
     String command=input.readLine();
     if("close".equals(command)) {
      shared.release();FileLock idle=users.tryLock();
      if(idle==null){System.out.println("IN_USE");System.out.flush();return;}
      idle.release();System.out.println("CLOSED");System.out.flush();
     }
    }
   }
  }
 }
}
